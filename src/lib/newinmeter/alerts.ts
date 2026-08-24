import "server-only";

import { adminSupabaseCount, adminSupabaseFetch, adminSupabaseRequest } from "../supabase-rest";
import { formatCurrency, formatKwh } from "../format";
import { sendPushToUser } from "../push-notify";
import { ALERT_TYPES, FRESH_DATA_ALERT_TYPES, THRESHOLD_BOUNDS, type AlertType } from "./alert-types";
import { DemoAccountProtectedError, getConnectionRowForUser, setAutoSyncEnabled } from "./connection";
import { currentLocalDateString } from "./schedule";

export type { AlertType };
export { ALERT_TYPES, DEFAULT_THRESHOLDS, FRESH_DATA_ALERT_TYPES } from "./alert-types";

// Hours since last_synced_at before "data delayed" triggers. The auto-sync
// schedule is four windows/day (~5-7h apart -- see schedule.ts), so a single
// missed window is at most ~7h. 13h is past two consecutive missed windows
// in every case (worst adjacent pair is 7h + 6h), so one ordinary transient
// miss never notifies -- only a connection that's been stuck through at
// least two scheduled attempts does. Deliberately larger than the existing
// unconditional 6h staleness nudge (sync-status.ts) -- this is a separate,
// opt-in, more conservative signal, not a replacement for it.
export const DATA_DELAYED_AFTER_HOURS = 13;

export class AlertRuleValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AlertRuleValidationError";
  }
}

// Thrown when a caller tries to enable a fresh-data alert while automatic
// updates are off, without confirming they also want auto-sync turned on
// (see upsertAlertRule's alsoEnableAutoSync param). The route layer turns
// this into a 409 the client treats as "ask the user to confirm."
export class AutoSyncRequiredError extends Error {
  constructor() {
    super("Automatic updates must be on for this alert to work.");
    this.name = "AutoSyncRequiredError";
  }
}

export type AlertRule = {
  id: string;
  connectionId: string;
  type: AlertType;
  enabled: boolean;
  threshold: number | null;
  updatedAt: string;
};

type AlertRuleRow = {
  id: string;
  connection_id: string;
  type: AlertType;
  enabled: boolean;
  threshold: number | string | null;
  updated_at: string;
};

const RULE_SELECT = "id,connection_id,type,enabled,threshold,updated_at";

export function toNumber(value: number | string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function rowToRule(row: AlertRuleRow): AlertRule {
  return {
    id: row.id,
    connectionId: row.connection_id,
    type: row.type,
    enabled: row.enabled,
    threshold: toNumber(row.threshold),
    updatedAt: row.updated_at
  };
}

function isUniqueViolation(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("23505") || message.includes("duplicate key");
}

// Server-side threshold validation -- the browser's own input constraints
// are not trusted as the only check. Returns a human message, or null when
// valid.
export function validateThreshold(type: AlertType, threshold: number | null): string | null {
  if (type === "data_delayed") {
    return threshold === null ? null : "This alert has no configurable threshold.";
  }

  if (threshold === null || !Number.isFinite(threshold)) {
    return "A threshold is required.";
  }

  const bounds = THRESHOLD_BOUNDS[type];
  if (threshold <= bounds.min) {
    return `Must be greater than ${bounds.min}.`;
  }
  if (threshold > bounds.max) {
    return `Must be ${bounds.max.toLocaleString()} or less.`;
  }
  return null;
}

// Every configured rule for the user's own connection. Never pre-creates
// rows for types the user hasn't touched -- the caller (Settings UI) fills
// gaps with DEFAULT_THRESHOLDS and enabled: false.
export async function getAlertRulesForUser(userId: string): Promise<AlertRule[]> {
  const connectionRow = await getConnectionRowForUser(userId);
  if (!connectionRow) {
    return [];
  }

  const rows = await adminSupabaseFetch<AlertRuleRow[]>(
    `/alert_rules?select=${RULE_SELECT}&connection_id=eq.${encodeURIComponent(connectionRow.id)}`
  );
  return rows.map(rowToRule);
}

export type UpsertAlertRuleParams = {
  userId: string;
  type: AlertType;
  enabled: boolean;
  threshold: number | null;
  // Explicit confirmation from the client that turning this rule on should
  // also turn automatic updates on, when they're currently off. Without
  // this, enabling a fresh-data alert with auto-sync off throws
  // AutoSyncRequiredError instead of silently leaving a "configured but
  // dead" alert.
  alsoEnableAutoSync?: boolean;
};

export type UpsertAlertRuleResult = {
  rule: AlertRule;
  autoSyncEnabled: boolean;
  // Only changes from the connection's already-known value when this call
  // itself just turned auto-sync on (alsoEnableAutoSync) -- setAutoSyncEnabled
  // already computes and returns it via computeNextAutoSyncAt, so this just
  // carries that through instead of leaving the caller to guess/refetch.
  nextSyncAt: string | null;
};

export async function upsertAlertRule(params: UpsertAlertRuleParams): Promise<UpsertAlertRuleResult> {
  const connectionRow = await getConnectionRowForUser(params.userId);
  if (!connectionRow) {
    throw new Error("No LiveMopay connection for this user.");
  }
  if (connectionRow.is_demo) {
    throw new DemoAccountProtectedError("alerts");
  }

  const validationError = validateThreshold(params.type, params.threshold);
  if (validationError) {
    throw new AlertRuleValidationError(validationError);
  }

  let autoSyncEnabled = connectionRow.auto_sync_enabled;
  let nextSyncAt = connectionRow.next_sync_at;

  if (params.enabled && FRESH_DATA_ALERT_TYPES.includes(params.type) && !connectionRow.auto_sync_enabled) {
    if (!params.alsoEnableAutoSync) {
      throw new AutoSyncRequiredError();
    }
    const updatedConnection = await setAutoSyncEnabled(params.userId, true);
    autoSyncEnabled = true;
    nextSyncAt = updatedConnection.nextSyncAt;
  }

  const rows = await adminSupabaseRequest<AlertRuleRow[]>(
    "POST",
    "/alert_rules?on_conflict=connection_id,type",
    {
      connection_id: connectionRow.id,
      type: params.type,
      enabled: params.enabled,
      threshold: params.type === "data_delayed" ? null : params.threshold
    },
    "resolution=merge-duplicates,return=representation"
  );

  return { rule: rowToRule(rows[0]), autoSyncEnabled, nextSyncAt };
}

// Called when a user turns automatic updates off while one or more
// fresh-data alerts are enabled -- "disable them together" (the simpler of
// the two options the product spec allows; the client is expected to warn
// the user before calling this, via /api/livemopay/auto-sync). data_delayed
// is untouched since it doesn't depend on auto-sync. Returns which types
// were actually disabled, so the caller can report back to the client.
export async function disableFreshDataAlertRules(connectionId: string): Promise<AlertType[]> {
  const typesList = FRESH_DATA_ALERT_TYPES.join(",");
  const rows = await adminSupabaseRequest<AlertRuleRow[]>(
    "PATCH",
    `/alert_rules?connection_id=eq.${encodeURIComponent(connectionId)}&type=in.(${typesList})&enabled=eq.true`,
    { enabled: false, updated_at: new Date().toISOString() },
    "return=representation"
  );
  return rows.map((row) => row.type);
}

type ActiveEventRow = { id: string };

async function getActiveEvent(alertRuleId: string): Promise<ActiveEventRow | null> {
  const rows = await adminSupabaseFetch<ActiveEventRow[]>(
    `/alert_events?select=id&alert_rule_id=eq.${encodeURIComponent(alertRuleId)}&resolved_at=is.null&limit=1`
  );
  return rows[0] ?? null;
}

async function resolveEvent(eventId: string): Promise<void> {
  await adminSupabaseRequest(
    "PATCH",
    `/alert_events?id=eq.${encodeURIComponent(eventId)}`,
    { resolved_at: new Date().toISOString() },
    "return=minimal"
  );
}

async function markEventNotified(eventId: string): Promise<void> {
  await adminSupabaseRequest(
    "PATCH",
    `/alert_events?id=eq.${encodeURIComponent(eventId)}`,
    { notification_sent_at: new Date().toISOString() },
    "return=minimal"
  );
}

export type NotifyCopy = { title: string; body: string; url: string; tag: string };

// Narrower than AlertRuleRow -- only what the copy actually depends on.
// Lets this be reused for a *historical* event's copy (notification
// centre), where the correct threshold is the one snapshotted on the event
// at trigger time (alert_events.threshold_value), not the rule's current
// (possibly since-edited) threshold.
type NotifyCopyInput = { type: AlertType; threshold: number | string | null };

// Single source of truth for alert-type copy -- both the live evaluator
// (push, at trigger time) and the notification centre (in-app, any time
// after) call this, so the two never drift apart.
export function notifyCopyFor(rule: NotifyCopyInput, currentValue: number): NotifyCopy {
  switch (rule.type) {
    case "low_balance":
      return {
        title: "Low balance",
        body: `Your balance is ${formatCurrency(currentValue)}, below your ${formatCurrency(toNumber(rule.threshold) ?? 0)} alert.`,
        url: "/",
        tag: "newinmeter-alert-low-balance"
      };
    case "daily_spend":
      return {
        title: "Daily spending alert",
        body: `You've spent ${formatCurrency(currentValue)} today, above your ${formatCurrency(toNumber(rule.threshold) ?? 0)} limit.`,
        url: "/",
        tag: "newinmeter-alert-daily-spend"
      };
    case "daily_kwh":
      return {
        title: "Electricity usage alert",
        body: `You've used ${formatKwh(currentValue)} today, above your ${formatKwh(toNumber(rule.threshold) ?? 0)} alert.`,
        url: "/",
        tag: "newinmeter-alert-daily-kwh"
      };
    case "data_delayed":
      return {
        title: "Meter data delayed",
        body: "NewinMeter hasn't received fresh LiveMopay data as expected.",
        url: "/settings?tab=data-sync",
        tag: "newinmeter-alert-data-delayed"
      };
  }
}

// Active-event dedup (low_balance, data_delayed): a condition that stays
// true across many syncs only ever has one open event, so only the first
// crossing notifies. Crossing back clears it (no "resolved" notification --
// see the module comment on this being deliberately boring); a later
// re-crossing creates a fresh event/notification.
async function evaluateActiveEventAlert(
  rule: AlertRuleRow,
  userId: string,
  connectionId: string,
  currentValue: number,
  crossed: boolean
): Promise<void> {
  const active = await getActiveEvent(rule.id);

  if (!crossed) {
    if (active) {
      await resolveEvent(active.id);
    }
    return;
  }

  if (active) {
    return;
  }

  const inserted = await adminSupabaseRequest<Array<{ id: string }>>(
    "POST",
    "/alert_events",
    {
      alert_rule_id: rule.id,
      connection_id: connectionId,
      trigger_value: currentValue,
      threshold_value: rule.threshold
    },
    "return=representation"
  );

  const copy = notifyCopyFor(rule, currentValue);
  const reached = await sendPushToUser(userId, copy);
  if (reached > 0) {
    await markEventNotified(inserted[0].id);
  }
}

// Date-scoped dedup (daily_spend, daily_kwh): the unique index on
// (alert_rule_id, period_date) is the actual dedup mechanism -- a duplicate
// insert for the same SAST day fails uniqueness and is treated as "already
// notified today," not an error. This also makes it race-safe against a
// manual and automatic sync landing close together.
async function evaluateDailyThresholdAlert(
  rule: AlertRuleRow,
  userId: string,
  connectionId: string,
  currentValue: number,
  crossed: boolean,
  periodDate: string
): Promise<void> {
  if (!crossed) {
    return;
  }

  let insertedId: string;
  try {
    const inserted = await adminSupabaseRequest<Array<{ id: string }>>(
      "POST",
      "/alert_events",
      {
        alert_rule_id: rule.id,
        connection_id: connectionId,
        period_date: periodDate,
        trigger_value: currentValue,
        threshold_value: rule.threshold
      },
      "return=representation"
    );
    insertedId = inserted[0].id;
  } catch (error) {
    if (isUniqueViolation(error)) {
      return;
    }
    throw error;
  }

  const copy = notifyCopyFor(rule, currentValue);
  const reached = await sendPushToUser(userId, copy);
  if (reached > 0) {
    await markEventNotified(insertedId);
  }
}

// Resolves any still-open data_delayed event for this connection -- called
// on every successful sync (manual or automatic), independent of whether
// the data_delayed rule is currently enabled, so a lingering open event
// from before the user disabled it doesn't stay open forever.
async function resolveDataDelayedIfActive(connectionId: string): Promise<void> {
  const rows = await adminSupabaseFetch<AlertRuleRow[]>(
    `/alert_rules?select=${RULE_SELECT}&connection_id=eq.${encodeURIComponent(connectionId)}&type=eq.data_delayed&limit=1`
  );
  const rule = rows[0];
  if (!rule) {
    return;
  }

  const active = await getActiveEvent(rule.id);
  if (active) {
    await resolveEvent(active.id);
  }
}

// The post-successful-sync hook. Called from both /api/sync (manual) and
// /api/cron/auto-sync (automatic) right after runLivemopaySync() resolves --
// rollups and dashboard_summary are guaranteed fresh at that point, since
// the rollup-refresh trigger fires synchronously inside finish_capture_run's
// own UPDATE statement (see refresh_livenopay_rollups_for_run). Never
// throws: an alert-evaluation failure must not affect the sync's own
// success/failure, so every error is caught and logged here, not
// propagated.
export async function evaluateAlertsAfterSync(connectionId: string, userId: string): Promise<void> {
  try {
    const rules = await adminSupabaseFetch<AlertRuleRow[]>(
      `/alert_rules?select=${RULE_SELECT}&connection_id=eq.${encodeURIComponent(connectionId)}&enabled=eq.true&type=in.(low_balance,daily_spend,daily_kwh)`
    );

    if (rules.length > 0) {
      const [summaryRow] = await adminSupabaseFetch<Array<{ latest_balance: number | string | null }>>(
        `/dashboard_summary?select=latest_balance&connection_id=eq.${encodeURIComponent(connectionId)}&limit=1`
      );
      const balance = toNumber(summaryRow?.latest_balance ?? null);

      const today = currentLocalDateString(new Date());
      const [todayRollup] = await adminSupabaseFetch<
        Array<{ total_spend: number | string; energy_kwh: number | string }>
      >(
        `/energy_day_rollups?select=total_spend,energy_kwh&connection_id=eq.${encodeURIComponent(connectionId)}&period_date=eq.${today}&limit=1`
      );
      const todaySpend = toNumber(todayRollup?.total_spend ?? 0) ?? 0;
      const todayKwh = toNumber(todayRollup?.energy_kwh ?? 0) ?? 0;

      for (const rule of rules) {
        if (rule.type === "low_balance") {
          if (balance === null) continue;
          const threshold = toNumber(rule.threshold) ?? 0;
          await evaluateActiveEventAlert(rule, userId, connectionId, balance, balance < threshold);
        } else if (rule.type === "daily_spend") {
          const threshold = toNumber(rule.threshold) ?? 0;
          await evaluateDailyThresholdAlert(rule, userId, connectionId, todaySpend, todaySpend > threshold, today);
        } else if (rule.type === "daily_kwh") {
          const threshold = toNumber(rule.threshold) ?? 0;
          await evaluateDailyThresholdAlert(rule, userId, connectionId, todayKwh, todayKwh > threshold, today);
        }
      }
    }

    await resolveDataDelayedIfActive(connectionId);
  } catch (error) {
    console.error(
      "newinmeter_alert_evaluation_failed",
      connectionId,
      error instanceof Error ? error.message : String(error)
    );
  }
}

// Settings' low_balance row shows this next to the threshold input ("Your
// balance is currently RX") so setting a threshold isn't a guess -- same
// dashboard_summary.latest_balance read evaluateAlertsAfterSync already
// does, just exposed for display rather than comparison. Returns null on
// any failure (no connection, no summary row yet) -- this is a helpful
// hint, never something Settings should fail to render over.
export async function getLatestBalanceForUser(userId: string): Promise<number | null> {
  const connectionRow = await getConnectionRowForUser(userId);
  if (!connectionRow) return null;

  const [summaryRow] = await adminSupabaseFetch<Array<{ latest_balance: number | string | null }>>(
    `/dashboard_summary?select=latest_balance&connection_id=eq.${encodeURIComponent(connectionRow.id)}&limit=1`
  );
  return toNumber(summaryRow?.latest_balance ?? null);
}

type StaleConnectionForAlerts = {
  connectionId: string;
  userId: string;
  lastSyncedAt: string | null;
};

// Called from the existing /api/cron/stale-check tick (no second scheduler --
// see the module comment above and MULTI_USER_SETUP.md). data_delayed is the
// one alert type that can't be evaluated on a sync-success hook, since "no
// sync happened" is exactly the condition it detects.
export async function evaluateDataDelayedAlerts(connections: StaleConnectionForAlerts[]): Promise<{
  checked: number;
  notified: number;
}> {
  if (connections.length === 0) {
    return { checked: 0, notified: 0 };
  }

  const connectionIds = connections.map((c) => c.connectionId).join(",");
  const rules = await adminSupabaseFetch<AlertRuleRow[]>(
    `/alert_rules?select=${RULE_SELECT}&type=eq.data_delayed&enabled=eq.true&connection_id=in.(${connectionIds})`
  );

  if (rules.length === 0) {
    return { checked: 0, notified: 0 };
  }

  const connectionById = new Map(connections.map((c) => [c.connectionId, c]));
  const now = Date.now();
  let notified = 0;

  for (const rule of rules) {
    const connection = connectionById.get(rule.connection_id);
    if (!connection) continue;

    const hoursSinceSync = connection.lastSyncedAt
      ? (now - new Date(connection.lastSyncedAt).getTime()) / 3_600_000
      : Number.POSITIVE_INFINITY;

    if (hoursSinceSync < DATA_DELAYED_AFTER_HOURS) {
      continue;
    }

    const active = await getActiveEvent(rule.id);
    if (active) {
      continue;
    }

    const inserted = await adminSupabaseRequest<Array<{ id: string }>>(
      "POST",
      "/alert_events",
      {
        alert_rule_id: rule.id,
        connection_id: rule.connection_id,
        trigger_value: Math.round(hoursSinceSync * 100) / 100,
        threshold_value: null
      },
      "return=representation"
    );

    const copy = notifyCopyFor(rule, hoursSinceSync);
    const reached = await sendPushToUser(connection.userId, copy);
    if (reached > 0) {
      await markEventNotified(inserted[0].id);
      notified += 1;
    }
  }

  return { checked: rules.length, notified };
}

// ---------------------------------------------------------------------------
// Notification centre (header bell)
// ---------------------------------------------------------------------------
//
// alert_events is the source of truth -- this reads it, it doesn't create a
// second notifications table. Every write here (mark one/all read) goes
// through the same service-role + resolved-connection_id pattern as the
// rest of this file (see disableFreshDataAlertRules, markAutoSyncSuccess,
// etc.), not a new grantable Postgres function -- alert_events' RLS stays
// exactly select-only for authenticated (20260824020000), so its
// system-generated fields (trigger_value, threshold_value, resolved_at,
// connection_id, alert_rule_id) remain fully protected from any
// authenticated write, direct or otherwise. Ownership for every operation
// below is resolved from the authenticated caller's userId via
// getConnectionRowForUser -- never from a client-supplied id -- and every
// write additionally filters by that resolved connection_id, so an event
// id that doesn't belong to the caller simply matches zero rows rather
// than ever touching another user's data.

const NOTIFICATION_LIST_LIMIT = 30;

export type NotificationItem = {
  id: string;
  type: AlertType;
  title: string;
  body: string;
  url: string;
  triggeredAt: string;
  readAt: string | null;
  isRead: boolean;
};

type AlertEventRow = {
  id: string;
  alert_rule_id: string;
  triggered_at: string;
  trigger_value: number | string;
  threshold_value: number | string | null;
  read_at: string | null;
};

// Recent notifications for the header bell -- capped, newest first,
// includes resolved historical events (resolution isn't a UX concept here,
// only read/unread is -- see the module comment on alert_events staying the
// source of truth). Two small admin-scoped queries (events + this
// connection's handful of rules) rather than a PostgREST embedded select --
// this codebase has no existing embedded-select precedent, and the rule
// list per connection is at most 4 rows, so the extra round trip is
// negligible and keeps the query shape consistent with every other read in
// this file.
export async function getRecentNotifications(
  userId: string,
  limit: number = NOTIFICATION_LIST_LIMIT
): Promise<NotificationItem[]> {
  const connectionRow = await getConnectionRowForUser(userId);
  if (!connectionRow) {
    return [];
  }

  const [rules, events] = await Promise.all([
    adminSupabaseFetch<Array<{ id: string; type: AlertType }>>(
      `/alert_rules?select=id,type&connection_id=eq.${encodeURIComponent(connectionRow.id)}`
    ),
    adminSupabaseFetch<AlertEventRow[]>(
      `/alert_events?select=id,alert_rule_id,triggered_at,trigger_value,threshold_value,read_at&connection_id=eq.${encodeURIComponent(connectionRow.id)}&order=triggered_at.desc&limit=${limit}`
    )
  ]);

  const typeByRuleId = new Map(rules.map((rule) => [rule.id, rule.type]));

  // flatMap rather than map+filter: skips an event whose rule no longer
  // resolves (shouldn't happen -- alert_rule_id cascades on delete -- but
  // there's nothing meaningful to render without knowing the type, so drop
  // it rather than guess).
  return events.flatMap((event) => {
    const type = typeByRuleId.get(event.alert_rule_id);
    if (!type) {
      return [];
    }

    const currentValue = toNumber(event.trigger_value) ?? 0;
    // threshold_value is the snapshot from when THIS event triggered, not
    // the rule's current threshold -- see notifyCopyFor's own comment on
    // why that distinction matters for historical accuracy.
    const copy = notifyCopyFor({ type, threshold: event.threshold_value }, currentValue);

    return [
      {
        id: event.id,
        type,
        title: copy.title,
        body: copy.body,
        url: copy.url,
        triggeredAt: event.triggered_at,
        readAt: event.read_at,
        isRead: event.read_at !== null
      }
    ];
  });
}

// Distinguishes "nothing has happened yet" from "nothing is even being
// watched" for the notification centre's empty state -- an empty
// alert_events list means something different to a user with zero enabled
// alert_rules (point them at Settings) than to one whose alerts just
// haven't fired (nothing to do but wait).
export async function hasAnyEnabledAlertRule(userId: string): Promise<boolean> {
  const connectionRow = await getConnectionRowForUser(userId);
  if (!connectionRow) {
    return false;
  }

  const count = await adminSupabaseCount(
    `/alert_rules?connection_id=eq.${encodeURIComponent(connectionRow.id)}&enabled=eq.true`
  );
  return count > 0;
}

// Unread count for the bell badge -- deliberately independent of
// resolved_at (a resolved historical event can still be unread; those are
// different concepts, see the module comment). Exact count via PostgREST's
// Content-Range header, no rows fetched.
export async function getUnreadNotificationCount(userId: string): Promise<number> {
  const connectionRow = await getConnectionRowForUser(userId);
  if (!connectionRow) {
    return 0;
  }

  return adminSupabaseCount(
    `/alert_events?connection_id=eq.${encodeURIComponent(connectionRow.id)}&read_at=is.null`
  );
}

// Marks one notification read. The read_at=is.null filter makes this
// naturally idempotent (re-marking an already-read event matches zero rows,
// not an error) and the connection_id filter makes it ownership-safe (an
// event id belonging to another user's connection also matches zero rows --
// there is no separate existence check that could leak whether the id
// exists at all).
export async function markNotificationRead(userId: string, eventId: string): Promise<void> {
  const connectionRow = await getConnectionRowForUser(userId);
  if (!connectionRow) {
    return;
  }

  await adminSupabaseRequest(
    "PATCH",
    `/alert_events?id=eq.${encodeURIComponent(eventId)}&connection_id=eq.${encodeURIComponent(connectionRow.id)}&read_at=is.null`,
    { read_at: new Date().toISOString() },
    "return=minimal"
  );
}

// Marks every currently-unread notification read for this user's own
// connection. Returns how many were actually marked, so the caller can
// report/verify without a second round trip.
export async function markAllNotificationsRead(userId: string): Promise<number> {
  const connectionRow = await getConnectionRowForUser(userId);
  if (!connectionRow) {
    return 0;
  }

  const rows = await adminSupabaseRequest<Array<{ id: string }>>(
    "PATCH",
    `/alert_events?connection_id=eq.${encodeURIComponent(connectionRow.id)}&read_at=is.null`,
    { read_at: new Date().toISOString() },
    "return=representation"
  );

  return rows.length;
}
