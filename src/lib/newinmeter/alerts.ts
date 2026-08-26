import "server-only";

import { adminSupabaseCount, adminSupabaseFetch, adminSupabaseRequest } from "../supabase-rest";
import { formatCurrency, formatKwh, formatTariff } from "../format";
import { getFeatureAccessForUsers, hasFeatureAccess } from "../features";
import { sendPushToUser } from "../push-notify";
import { reportAlertEvaluationOutcome } from "../diagnostics/operations";
import {
  ALERT_TYPES,
  FRESH_DATA_ALERT_TYPES,
  THRESHOLD_ALERT_TYPES,
  THRESHOLD_BOUNDS,
  type AlertType
} from "./alert-types";
import { DemoAccountProtectedError, getConnectionRowForUser, setAutoSyncEnabled } from "./connection";
import { currentLocalDateString, currentLocalMonthProgress, currentLocalMonthString } from "./schedule";
import { getTariffProfile, isApproachingNextBand, resolveMonthlyBand } from "./tariff-profiles";

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
  if (!THRESHOLD_ALERT_TYPES.includes(type)) {
    return threshold === null ? null : "This alert has no configurable threshold.";
  }

  if (threshold === null || !Number.isFinite(threshold)) {
    return "A threshold is required.";
  }

  if (type === "balance_runway" && !Number.isInteger(threshold)) {
    return "Must be a whole number of days.";
  }

  const bounds = THRESHOLD_BOUNDS[type];
  if (!bounds) {
    return null;
  }
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
      threshold: THRESHOLD_ALERT_TYPES.includes(params.type) ? params.threshold : null
    },
    "resolution=merge-duplicates,return=representation"
  );

  // See clearAlertRuleState's own comment: disabling a rule must wipe any
  // evaluator-state it was carrying, so a later re-enable starts from a
  // fresh silent baseline instead of comparing against a value that went
  // stale while the rule was off.
  if (!params.enabled) {
    await clearAlertRuleState(rows[0].id);
  }

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

  // Same reasoning as upsertAlertRule's own single-rule disable path --
  // every rule this just turned off must have its evaluator state cleared
  // too, not only the ones a user disables one at a time in Settings.
  await Promise.all(rows.map((row) => clearAlertRuleState(row.id)));

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

// Wipes an alert's evaluator-state row, if it has one -- called whenever a
// rule transitions to disabled (see upsertAlertRule/disableFreshDataAlertRules
// below). A disabled rule is never evaluated, so any stale state left
// behind (tariff_changed's lastObservedTariff, today) would otherwise sit
// unrefreshed through however long the rule stays off; re-enabling it
// later would then compare TODAY's real tariff against that stale value
// and wrongly notify about a change that actually happened while the rule
// was off. Deleting the state row makes re-enable behave exactly like a
// first enable -- see evaluateTariffFamily's own "lastObserved === undefined"
// branch -- establishing a silent fresh baseline instead. A DELETE
// matching zero rows (no state existed, or the type doesn't use this
// table at all) is a normal no-op, not an error, so this is safe to call
// unconditionally on every disable rather than special-casing tariff_changed
// by name -- any future evaluator-state type gets this for free.
async function clearAlertRuleState(alertRuleId: string): Promise<void> {
  await adminSupabaseRequest(
    "DELETE",
    `/alert_rule_state?alert_rule_id=eq.${encodeURIComponent(alertRuleId)}`,
    undefined,
    "return=minimal"
  );
}

export type NotifyCopy = { title: string; body: string; url: string; tag: string };

// Narrower than AlertRuleRow -- only what the copy actually depends on.
// Lets this be reused for a *historical* event's copy (notification
// centre), where the correct values are the ones snapshotted on the event
// at trigger time (alert_events.threshold_value / event_context), not the
// rule's current (possibly since-edited) threshold or today's live data.
// `context` is the v2 types' richer snapshot (see event_context's own
// column comment in the migration) -- v1 types don't set/read it, so their
// existing call shape (threshold + currentValue only) is untouched.
type NotifyCopyInput = {
  type: AlertType;
  threshold: number | string | null;
  context?: Record<string, unknown> | null;
};

function contextNumber(context: Record<string, unknown> | null | undefined, key: string): number {
  const value = context?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function contextString(context: Record<string, unknown> | null | undefined, key: string): string {
  const value = context?.[key];
  return typeof value === "string" ? value : "";
}

// Natural rounding for a days estimate -- "about 3 days", never
// "2.738492 days". Whole days below a week, otherwise still whole (the
// alert only ever fires within the 1-30 day configurable range anyway).
function roundedDays(value: number): number {
  return Math.max(0, Math.round(value));
}

// startAt/endAt (usage_anomaly's event_context) are naive local (SAST)
// "YYYY-MM-DDTHH:MM:SS" strings -- same convention as
// usage_activities.starts_at/ends_at (timestamp without time zone) and
// energy_hourly_rollups' own period_date+hour. No timezone conversion is
// needed anywhere here: these values already ARE the local wall clock.
function localMinutesOfDay(value: string): number {
  return Number(value.slice(11, 13)) * 60 + Number(value.slice(14, 16));
}

function formatHour12(hour: number): string {
  const normalized = ((hour % 24) + 24) % 24;
  const period = normalized >= 12 ? "PM" : "AM";
  const twelveHour = normalized % 12 === 0 ? 12 : normalized % 12;
  return `${twelveHour} ${period}`;
}

// "around 7 PM" for an 18:00-20:00 window is the MIDPOINT rounded to the
// nearest hour, not the start time -- matches the product copy's own
// worked example exactly.
function usageAnomalyTimeLabel(startAt: string, endAt: string): { around: string; start: string; end: string } {
  const startMinutes = localMinutesOfDay(startAt);
  const endMinutes = localMinutesOfDay(endAt);
  const midHour = Math.round((startMinutes + endMinutes) / 2 / 60);
  return {
    around: formatHour12(midHour),
    start: startAt.slice(11, 16),
    end: endAt.slice(11, 16)
  };
}

// The deep-link contract: Activities opens with Add Activity already open,
// prefilled to the exact anomalous date/time range -- see
// activities-page-client.tsx's own handling of these params. No auto-save;
// the user reviews/edits/cancels normally.
function usageAnomalyDeepLink(startAt: string, endAt: string): string {
  const date = startAt.slice(0, 10);
  const start = startAt.slice(11, 16);
  const end = endAt.slice(11, 16);
  return `/activities?new=1&date=${date}&start=${start}&end=${end}&source=usage-alert`;
}

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
    case "balance_runway": {
      const balance = contextNumber(rule.context, "balance");
      const days = roundedDays(contextNumber(rule.context, "estimatedDaysRemaining"));
      return {
        title: "Balance running out soon",
        body: `Your ${formatCurrency(balance)} balance may last about ${days} ${days === 1 ? "day" : "days"} at your recent spending rate.`,
        url: "/",
        tag: "newinmeter-alert-balance-runway"
      };
    }
    case "monthly_budget": {
      const mtd = contextNumber(rule.context, "monthToDateSpend");
      const projected = contextNumber(rule.context, "projectedSpend");
      const budget = contextNumber(rule.context, "budget");
      return {
        title: "Spending is ahead of budget",
        body: `You've spent ${formatCurrency(mtd)} this month. At your recent pace, you're heading for about ${formatCurrency(projected)} against your ${formatCurrency(budget)} budget.`,
        url: "/",
        tag: "newinmeter-alert-monthly-budget"
      };
    }
    case "tariff_changed": {
      const previous = contextNumber(rule.context, "previousTariff");
      const current = contextNumber(rule.context, "currentTariff");
      return {
        title: "Electricity tariff changed",
        body: `Your electricity rate changed from ${formatTariff(previous)} to ${formatTariff(current)}.`,
        url: "/data",
        tag: "newinmeter-alert-tariff-changed"
      };
    }
    case "tariff_band_approaching": {
      const monthKwh = contextNumber(rule.context, "monthKwh");
      const nextBandKwh = contextNumber(rule.context, "nextBandKwh");
      return {
        title: "Approaching a higher tariff band",
        body: `You've used ${formatKwh(monthKwh)} this month. Your next tariff band starts at ${formatKwh(nextBandKwh)}.`,
        url: "/data",
        tag: "newinmeter-alert-tariff-band"
      };
    }
    case "usage_anomaly": {
      const startAt = contextString(rule.context, "startAt");
      const endAt = contextString(rule.context, "endAt");
      const label = usageAnomalyTimeLabel(startAt, endAt);
      return {
        title: `What happened around ${label.around}?`,
        body: `Electricity use was much higher than usual between ${label.start} and ${label.end}. Add an activity if you know what was running.`,
        url: usageAnomalyDeepLink(startAt, endAt),
        tag: "newinmeter-alert-usage-anomaly"
      };
    }
  }
}

type EvaluateOptions = {
  // The correlation-suppression escape hatch (see the module comment above
  // evaluateAlertsAfterSync's pairing logic): the event still gets
  // created/deduped exactly as normal -- its own state advances so it
  // never nags on the next sync -- but the push send is skipped AND the
  // row is written with suppressed: true, so the Notification Centre never
  // shows it either. One condition cluster -> one user-visible
  // notification, not one push plus a second silent-but-still-listed bell
  // entry.
  suppressPush?: boolean;
};

// Active-event dedup (low_balance, balance_runway, data_delayed): a
// condition that stays true across many syncs only ever has one open
// event, so only the first crossing notifies. Crossing back clears it (no
// "resolved" notification -- see the module comment on this being
// deliberately boring); a later re-crossing creates a fresh
// event/notification. `resolveCondition` defaults to `!crossed` (the
// original three types' shape: enter and exit at the same boundary); a
// caller that needs hysteresis (balance_runway) passes a separate, looser
// resolve condition so the event doesn't flap right at the threshold.
async function evaluateActiveEventAlert(
  rule: AlertRuleRow,
  userId: string,
  connectionId: string,
  currentValue: number,
  crossed: boolean,
  context: Record<string, unknown> | null = null,
  options: EvaluateOptions & { resolveCondition?: boolean } = {}
): Promise<{ created: boolean }> {
  const resolveCondition = options.resolveCondition ?? !crossed;
  const active = await getActiveEvent(rule.id);

  if (active) {
    if (resolveCondition) {
      await resolveEvent(active.id);
    }
    return { created: false };
  }

  if (!crossed) {
    return { created: false };
  }

  const inserted = await adminSupabaseRequest<Array<{ id: string }>>(
    "POST",
    "/alert_events",
    {
      alert_rule_id: rule.id,
      connection_id: connectionId,
      trigger_value: currentValue,
      threshold_value: rule.threshold,
      event_context: context,
      suppressed: options.suppressPush === true
    },
    "return=representation"
  );

  if (options.suppressPush) {
    return { created: true };
  }

  const copy = notifyCopyFor({ type: rule.type, threshold: rule.threshold, context }, currentValue);
  const reached = await sendPushToUser(userId, copy);
  if (reached > 0) {
    await markEventNotified(inserted[0].id);
  }
  return { created: true };
}

// Dedup-scoped alerts: exactly one event per (rule, scope) -- scope is a
// SAST calendar day (daily_spend, daily_kwh, usage_anomaly -- via
// `periodDate`, the original mechanism) or a free-form key (monthly_budget,
// tariff_band_approaching -- via `dedupKey`, e.g. "2026-08" or
// "newinbosch_2026_27:2026-08:300"). Either way the relevant unique index
// (alert_events_one_per_rule_per_day_idx / _per_dedup_key_idx) is the real
// dedup mechanism -- a duplicate insert for the same scope fails uniqueness
// and is treated as "already notified for this scope," not an error. This
// also makes it race-safe against a manual and automatic sync landing
// close together.
async function evaluateDedupScopedAlert(
  rule: AlertRuleRow,
  userId: string,
  connectionId: string,
  currentValue: number,
  crossed: boolean,
  scope: { periodDate?: string; dedupKey?: string },
  context: Record<string, unknown> | null = null,
  options: EvaluateOptions = {}
): Promise<{ created: boolean }> {
  if (!crossed) {
    return { created: false };
  }

  let insertedId: string;
  try {
    const inserted = await adminSupabaseRequest<Array<{ id: string }>>(
      "POST",
      "/alert_events",
      {
        alert_rule_id: rule.id,
        connection_id: connectionId,
        period_date: scope.periodDate ?? null,
        dedup_key: scope.dedupKey ?? null,
        trigger_value: currentValue,
        threshold_value: rule.threshold,
        event_context: context,
        suppressed: options.suppressPush === true
      },
      "return=representation"
    );
    insertedId = inserted[0].id;
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { created: false };
    }
    throw error;
  }

  if (options.suppressPush) {
    return { created: true };
  }

  const copy = notifyCopyFor({ type: rule.type, threshold: rule.threshold, context }, currentValue);
  const reached = await sendPushToUser(userId, copy);
  if (reached > 0) {
    await markEventNotified(insertedId);
  }
  return { created: true };
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

// ---------------------------------------------------------------------------
// Alerts v2 evaluators: balance_runway, monthly_budget, tariff_changed,
// tariff_band_approaching, usage_anomaly
// ---------------------------------------------------------------------------

// Runway: needs 5 of the last 7 COMPLETE (is_complete, never today) SAST
// days to compute a burn rate at all -- a genuinely conservative floor, not
// a UX nicety. Hysteresis (trigger <=3, resolve >4) prevents flapping right
// at the boundary from one day's spend being R2 either side of the line.
const RUNWAY_MIN_HISTORY_DAYS = 5;
const RUNWAY_LOOKBACK_DAYS = 7;
const RUNWAY_RESOLVE_HYSTERESIS_DAYS = 1;

// Budget: same 5-complete-day floor as runway (they share the same recent-
// daily-rate figure), plus "a few days into the month" so a single unusual
// morning on the 1st can't project a scary number from almost no data.
const BUDGET_MIN_HISTORY_DAYS = 5;
const BUDGET_MIN_DAY_OF_MONTH = 3;

// Usage anomaly -- see evaluateUsageAnomalyFamily's own comment for how
// these are used. Magnitude thresholds chosen after a read-only look at
// this project's actual hourly kWh distribution (median ~0.16, p90 ~1.2,
// p99 ~3.4 kWh/hour) -- conservative on both axes so a small, ordinary
// swing never fires.
//
// ANOMALY_LOOKBACK_DAYS is 28, not 21 -- deliberately. Baselines are split
// by weekday/weekend (see below), and a 7-day week only contributes ~2
// weekend days, so a 21-day lookback gives a weekend slot only ~6
// comparison samples in the best case -- right at ANOMALY_MIN_HOURLY_
// SAMPLES' floor, with essentially no margin for one missed/incomplete
// weekend day before that slot silently stops evaluating (not incorrectly
// -- ANOMALY_MIN_HOURLY_SAMPLES still protects it from firing on too few
// samples -- but *permanently* short on samples is a real coverage bug,
// not a false-positive one). A read-only 28-day check across every real
// connection confirmed this: most have exactly 8 complete weekend samples
// per hour in a 28-day window, and the one connection with a real data gap
// still clears 6 -- comfortably above the floor, vs. the ~4-5 a 21-day
// window would have given that same connection. 28 days keeps the weekday
// side just as accurate (~20 samples, unchanged in practice) while giving
// the weekend side real headroom instead of a razor's edge.
const ANOMALY_LOOKBACK_DAYS = 28;
// Overall readiness gate: distinct calendar days (weekday + weekend
// combined) with at least one complete hourly reading, out of the last
// ANOMALY_LOOKBACK_DAYS -- "has this connection been feeding the evaluator
// long enough to bother running it at all". This is deliberately NOT a
// per-slot guarantee: it says nothing about whether any specific
// (hour, weekday/weekend) pair yet has enough same-class samples to
// compare against. That per-slot guarantee is ANOMALY_MIN_HOURLY_SAMPLES,
// below, checked independently for every candidate hour at evaluation
// time -- it is what actually protects a sparse weekend slot from firing
// on too little evidence, not this overall count. Two full weeks (half of
// the 28-day window) is a reasonable "the feature has been on for a
// while" signal without being so strict that a newly-enabled connection
// waits unnecessarily long for its Settings row to leave "Learning...".
const ANOMALY_MIN_LEARNING_DAYS = 14;
// Per-slot comparable-history floor: a candidate (hour, weekday/weekend)
// pair needs at least this many same-class historical observations before
// it is evaluated at all. This is the real protection for weekend slots --
// see the ANOMALY_LOOKBACK_DAYS comment above for why 28 days (not 21)
// keeps this floor meaningfully clear of the weekend sample pool rather
// than sitting right at its edge.
const ANOMALY_MIN_HOURLY_SAMPLES = 5;
const ANOMALY_BASELINE_FLOOR_KWH = 0.3;
const ANOMALY_MIN_RELATIVE_INCREASE = 1.8; // 80% above baseline
const ANOMALY_MIN_ABSOLUTE_INCREASE_KWH = 0.5;
const ANOMALY_MAX_WINDOW_HOURS = 4;
// An existing Activity must cover at least this fraction of the anomalous
// window's own duration to count as "already explained" -- a 5-minute
// activity barely touching a 3-hour window doesn't meet this; an activity
// that spans (or nearly spans) the window does.
const ANOMALY_OVERLAP_FRACTION = 0.5;

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function addDaysToDateString(dateString: string, days: number): string {
  const [year, month, day] = dateString.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return `${next.getUTCFullYear()}-${pad2(next.getUTCMonth() + 1)}-${pad2(next.getUTCDate())}`;
}

// Weekday/weekend only ever needs the calendar date, never a time-of-day,
// so treating the date string as UTC midnight for this one comparison is
// safe regardless of what timezone the server process itself is in.
function isWeekendDate(dateString: string): boolean {
  const day = new Date(`${dateString}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

// startAt/endAt/usage_activities' starts_at/ends_at are all naive-local
// (SAST) strings with no timezone suffix -- appending "Z" before parsing is
// a deliberate trick to get consistent, comparable epoch millis for
// duration arithmetic (not real UTC instants), safe here because every
// value being compared uses the exact same convention and Africa/
// Johannesburg has no DST to fight.
function naiveLocalMs(value: string): number {
  return new Date(`${value}Z`).getTime();
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

type DayRollupRow = {
  period_date: string;
  total_spend: number | string;
  energy_kwh: number | string;
  is_complete: boolean;
};

// Balance & spending family: low_balance, daily_spend, daily_kwh (all v1,
// unchanged semantics) plus balance_runway and monthly_budget (v2). One
// bounded rollup fetch (from the earlier of "7 days ago" and "start of this
// month" through today) feeds every one of them -- no per-alert query.
async function evaluateBalanceAndSpendFamily(
  ruleByType: Map<AlertType, AlertRuleRow>,
  connectionId: string,
  userId: string,
  today: string,
  now: Date
): Promise<void> {
  const lowBalanceRule = ruleByType.get("low_balance");
  const dailySpendRule = ruleByType.get("daily_spend");
  const dailyKwhRule = ruleByType.get("daily_kwh");
  const runwayRule = ruleByType.get("balance_runway");
  const budgetRule = ruleByType.get("monthly_budget");

  if (!lowBalanceRule && !dailySpendRule && !dailyKwhRule && !runwayRule && !budgetRule) {
    return;
  }

  const [summaryRow] = await adminSupabaseFetch<Array<{ latest_balance: number | string | null }>>(
    `/dashboard_summary?select=latest_balance&connection_id=eq.${encodeURIComponent(connectionId)}&limit=1`
  );
  const balance = toNumber(summaryRow?.latest_balance ?? null);

  const monthKey = currentLocalMonthString(now);
  const monthStart = `${monthKey}-01`;
  // The earlier of "start of this month" and "far enough back for the
  // runway lookback" -- must cover BOTH the full month-to-date (for
  // monthly_budget/tariff_band_approaching) AND the trailing
  // RUNWAY_LOOKBACK_DAYS complete days (for balance_runway/monthly_budget's
  // own daily-rate average), even when those two ranges don't overlap
  // (e.g. the 2nd of the month still needs several complete days from the
  // previous month for a real average). ISO date strings compare
  // correctly with `<`, so this is a plain min(), not "whichever is later"
  // -- an earlier version of this line had that inverted, which silently
  // truncated the month-to-date window to ~8 days for any evaluation past
  // the 8th of the month.
  const eightDaysAgo = addDaysToDateString(today, -RUNWAY_LOOKBACK_DAYS - 1);
  const since = monthStart < eightDaysAgo ? monthStart : eightDaysAgo;

  const rollupRows = await adminSupabaseFetch<DayRollupRow[]>(
    `/energy_day_rollups?select=period_date,total_spend,energy_kwh,is_complete&connection_id=eq.${encodeURIComponent(connectionId)}&period_date=gte.${since}&period_date=lte.${today}&order=period_date.asc`
  );

  const todayRollup = rollupRows.find((row) => row.period_date === today);
  const todaySpend = toNumber(todayRollup?.total_spend ?? 0) ?? 0;
  const todayKwh = toNumber(todayRollup?.energy_kwh ?? 0) ?? 0;

  const recentCompleteDays = rollupRows
    .filter((row) => row.is_complete && row.period_date !== today)
    .sort((a, b) => b.period_date.localeCompare(a.period_date))
    .slice(0, RUNWAY_LOOKBACK_DAYS);
  const hasEnoughRecentHistory = recentCompleteDays.length >= RUNWAY_MIN_HISTORY_DAYS;
  const recentDailySpends = recentCompleteDays.map((row) => toNumber(row.total_spend) ?? 0);
  const averageDailySpend = hasEnoughRecentHistory
    ? recentDailySpends.reduce((sum, value) => sum + value, 0) / recentDailySpends.length
    : null;

  // balance_runway evaluated FIRST -- the more informative predictive
  // alert wins the push when both it and low_balance would notify fresh in
  // the same cycle (see the correlation-suppression comment below).
  let runwayCreated = false;
  if (runwayRule && balance !== null && hasEnoughRecentHistory && averageDailySpend !== null && averageDailySpend > 0) {
    const threshold = toNumber(runwayRule.threshold) ?? 0;
    const estimatedDaysRemaining = Math.max(0, balance) / averageDailySpend;
    const crossed = estimatedDaysRemaining <= threshold;
    const resolveCondition = estimatedDaysRemaining > threshold + RUNWAY_RESOLVE_HYSTERESIS_DAYS;
    const context = {
      balance: round2(balance),
      averageDailySpend: round2(averageDailySpend),
      estimatedDaysRemaining: round2(estimatedDaysRemaining)
    };
    const result = await evaluateActiveEventAlert(
      runwayRule,
      userId,
      connectionId,
      estimatedDaysRemaining,
      crossed,
      context,
      { resolveCondition }
    );
    runwayCreated = result.created;
  } else if (runwayRule && balance !== null && (averageDailySpend === null || averageDailySpend <= 0)) {
    // Insufficient history, or no burn rate at all -- nothing to warn
    // about; resolve any stale active event rather than leaving it open
    // forever on a data gap.
    // Only resolve when we positively know the burn rate is now zero (a
    // real "no longer running out" fact) -- a plain insufficient-history
    // gap (e.g. a sync hiccup) leaves any existing active event alone
    // rather than resolving it on missing information.
    if (averageDailySpend !== null && averageDailySpend <= 0) {
      const active = await getActiveEvent(runwayRule.id);
      if (active) {
        await resolveEvent(active.id);
      }
    }
  }

  if (lowBalanceRule && balance !== null) {
    const threshold = toNumber(lowBalanceRule.threshold) ?? 0;
    await evaluateActiveEventAlert(lowBalanceRule, userId, connectionId, balance, balance < threshold, null, {
      suppressPush: runwayCreated
    });
  }

  // monthly_budget evaluated before daily_spend for the same reason.
  let budgetCreated = false;
  const { dayOfMonth, daysInMonth } = currentLocalMonthProgress(now);
  const monthRows = rollupRows.filter((row) => row.period_date >= monthStart);
  const monthToDateSpend = monthRows.reduce((sum, row) => sum + (toNumber(row.total_spend) ?? 0), 0);
  const hasEnoughBudgetHistory = hasEnoughRecentHistory && dayOfMonth >= BUDGET_MIN_DAY_OF_MONTH;

  if (budgetRule && hasEnoughBudgetHistory && averageDailySpend !== null) {
    const threshold = toNumber(budgetRule.threshold) ?? 0;
    const remainingDays = Math.max(0, daysInMonth - dayOfMonth);
    const projectedSpend = monthToDateSpend + averageDailySpend * remainingDays;
    const crossed = projectedSpend > threshold;
    const context = {
      monthToDateSpend: round2(monthToDateSpend),
      projectedSpend: round2(projectedSpend),
      budget: round2(threshold)
    };
    const result = await evaluateDedupScopedAlert(
      budgetRule,
      userId,
      connectionId,
      projectedSpend,
      crossed,
      { dedupKey: monthKey },
      context
    );
    budgetCreated = result.created;
  }

  if (dailySpendRule) {
    const threshold = toNumber(dailySpendRule.threshold) ?? 0;
    await evaluateDedupScopedAlert(
      dailySpendRule,
      userId,
      connectionId,
      todaySpend,
      todaySpend > threshold,
      { periodDate: today },
      null,
      { suppressPush: budgetCreated }
    );
  }

  if (dailyKwhRule) {
    const threshold = toNumber(dailyKwhRule.threshold) ?? 0;
    await evaluateDedupScopedAlert(dailyKwhRule, userId, connectionId, todayKwh, todayKwh > threshold, {
      periodDate: today
    });
  }
}

// Tariff family: tariff_changed (works for every connection, purely
// observational) and tariff_band_approaching (only when a tariff profile is
// known). One latest-observed-tariff read shared by both.
async function evaluateTariffFamily(
  ruleByType: Map<AlertType, AlertRuleRow>,
  connectionId: string,
  userId: string,
  today: string,
  now: Date
): Promise<void> {
  const changedRule = ruleByType.get("tariff_changed");
  const bandRule = ruleByType.get("tariff_band_approaching");

  if (!changedRule && !bandRule) {
    return;
  }

  const [latestEnergyRow] = await adminSupabaseFetch<Array<{ tariff: number | string }>>(
    `/energy_rows?select=tariff&connection_id=eq.${encodeURIComponent(connectionId)}&charge_kind=eq.energy&order=period_dt.desc&limit=1`
  );
  const currentTariff = toNumber(latestEnergyRow?.tariff ?? null);

  if (changedRule && currentTariff !== null) {
    const [stateRow] = await adminSupabaseFetch<Array<{ state: { lastObservedTariff?: number } }>>(
      `/alert_rule_state?select=state&alert_rule_id=eq.${encodeURIComponent(changedRule.id)}&limit=1`
    );
    const lastObserved = stateRow?.state?.lastObservedTariff;

    if (lastObserved === undefined) {
      // First enable: establish the baseline, no notification -- an old
      // historical tariff shift must never surface as if it just happened.
      await adminSupabaseRequest(
        "POST",
        "/alert_rule_state?on_conflict=alert_rule_id",
        {
          alert_rule_id: changedRule.id,
          state: { lastObservedTariff: currentTariff },
          updated_at: new Date().toISOString()
        },
        "resolution=merge-duplicates,return=minimal"
      );
    } else if (Math.abs(currentTariff - lastObserved) >= 0.005) {
      // A real change (beyond numeric(12,4) rounding noise) -- tariffs
      // only move at defined band edges, never gradually, so any change
      // past that epsilon is meaningful.
      // No periodDate/dedupKey scope here -- unlike daily_spend/
      // monthly_budget/tariff_band_approaching, this type's real dedup
      // guarantee is the state check just above (lastObserved is updated
      // to currentTariff immediately below, so the same change can never
      // be re-detected on a later sync); the partial unique index simply
      // doesn't apply to this insert.
      const context = { previousTariff: round2(lastObserved), currentTariff: round2(currentTariff) };
      await evaluateDedupScopedAlert(changedRule, userId, connectionId, currentTariff, true, {}, context);
      await adminSupabaseRequest(
        "POST",
        "/alert_rule_state?on_conflict=alert_rule_id",
        {
          alert_rule_id: changedRule.id,
          state: { lastObservedTariff: currentTariff },
          updated_at: new Date().toISOString()
        },
        "resolution=merge-duplicates,return=minimal"
      );
    }
  }

  if (bandRule) {
    const connectionRows = await adminSupabaseFetch<Array<{ tariff_profile: string | null }>>(
      `/livemopay_connections?select=tariff_profile&id=eq.${encodeURIComponent(connectionId)}&limit=1`
    );
    const profile = getTariffProfile(connectionRows[0]?.tariff_profile ?? null);

    if (profile) {
      const monthKey = currentLocalMonthString(now);
      const monthStart = `${monthKey}-01`;
      const monthRows = await adminSupabaseFetch<Array<{ energy_kwh: number | string }>>(
        `/energy_day_rollups?select=energy_kwh&connection_id=eq.${encodeURIComponent(connectionId)}&period_date=gte.${monthStart}&period_date=lte.${today}`
      );
      const monthKwh = monthRows.reduce((sum, row) => sum + (toNumber(row.energy_kwh) ?? 0), 0);
      const position = resolveMonthlyBand(profile, monthKwh);

      if (isApproachingNextBand(position, monthKwh) && position.nextThresholdKwh !== null) {
        const context = {
          profile: profile.key,
          monthKwh: round2(monthKwh),
          nextBandKwh: position.nextThresholdKwh
        };
        await evaluateDedupScopedAlert(
          bandRule,
          userId,
          connectionId,
          monthKwh,
          true,
          { dedupKey: `${profile.key}:${monthKey}:${position.nextThresholdKwh}` },
          context
        );
      }
    }
  }
}

type HourlyRollupRow = { period_date: string; hour: number; kwh: number | string; intervals: number };

// Usage anomaly: transparent, deterministic, conservative -- no ML. Same
// hour-of-day, same weekday/weekend type, last 4 weeks of COMPLETE hours
// (never today, never a partial hour) -- see ANOMALY_LOOKBACK_DAYS's own
// comment for why 4 weeks, not 3, is what actually keeps weekend
// comparisons reliable. Minimum 14 distinct historical days (either class)
// before this is considered "learned enough" to evaluate at all; minimum
// ANOMALY_MIN_HOURLY_SAMPLES same-class samples for the specific
// (hour, weekday/weekend) slot being checked, independent of that overall
// count. A candidate hour must clear BOTH a relative floor (>=80% above
// its own baseline, against a floor-protected denominator) and an absolute
// floor (>=0.5 kWh over baseline) -- prevents both "0.1 -> 0.2kWh, 100%
// higher!!" and "large house always uses a lot, everything looks
// -80%..+80% noisy" false positives. Adjacent anomalous hours merge into
// one bounded window; the strongest (highest total excess) window wins if
// several exist. At most one prompt per SAST day (period_date dedup, same
// mechanism as daily_spend/daily_kwh). An existing Activity covering >=50%
// of the window's own duration suppresses the prompt entirely -- they
// already explained it.
async function evaluateUsageAnomalyFamily(
  rule: AlertRuleRow | undefined,
  connectionId: string,
  userId: string,
  today: string
): Promise<void> {
  if (!rule) {
    return;
  }

  const lookbackStart = addDaysToDateString(today, -ANOMALY_LOOKBACK_DAYS);
  const hourlyRows = await adminSupabaseFetch<HourlyRollupRow[]>(
    `/energy_hourly_rollups?select=period_date,hour,kwh,intervals&connection_id=eq.${encodeURIComponent(connectionId)}&period_date=gte.${lookbackStart}&period_date=lte.${today}&order=period_date.asc`
  );

  const historicalByKey = new Map<string, number[]>();
  const distinctHistoricalDays = new Set<string>();
  const todayByHour = new Map<number, number>();

  for (const row of hourlyRows) {
    const kwh = toNumber(row.kwh) ?? 0;
    const complete = row.intervals >= 2;
    if (row.period_date === today) {
      if (complete) {
        todayByHour.set(row.hour, kwh);
      }
      continue;
    }
    if (!complete) {
      continue;
    }
    distinctHistoricalDays.add(row.period_date);
    const key = `${row.hour}:${isWeekendDate(row.period_date)}`;
    const samples = historicalByKey.get(key) ?? [];
    samples.push(kwh);
    historicalByKey.set(key, samples);
  }

  if (distinctHistoricalDays.size < ANOMALY_MIN_LEARNING_DAYS) {
    // Rule stays enabled; Settings' own "learning" hint (getAlertInsights)
    // reads distinctHistoricalDays.size separately for display -- nothing
    // to do here but wait for more days.
    return;
  }

  const todayIsWeekend = isWeekendDate(today);
  const candidates: Array<{ hour: number; value: number; baseline: number }> = [];

  for (const [hour, value] of Array.from(todayByHour.entries())) {
    const samples = historicalByKey.get(`${hour}:${todayIsWeekend}`) ?? [];
    if (samples.length < ANOMALY_MIN_HOURLY_SAMPLES) {
      continue;
    }
    const baselineMean = samples.reduce((sum, sample) => sum + sample, 0) / samples.length;
    const baselineFloor = Math.max(baselineMean, ANOMALY_BASELINE_FLOOR_KWH);
    const meetsRelative = value / baselineFloor >= ANOMALY_MIN_RELATIVE_INCREASE;
    const meetsAbsolute = value - baselineMean >= ANOMALY_MIN_ABSOLUTE_INCREASE_KWH;
    if (meetsRelative && meetsAbsolute) {
      candidates.push({ hour, value, baseline: baselineMean });
    }
  }

  if (candidates.length === 0) {
    return;
  }

  candidates.sort((a, b) => a.hour - b.hour);
  type Window = { startHour: number; endHour: number; excess: number; usageKwh: number; baselineKwh: number };
  const windows: Window[] = [];
  let current: Window | null = null;
  for (const candidate of candidates) {
    const excess = candidate.value - candidate.baseline;
    if (
      current &&
      candidate.hour === current.endHour + 1 &&
      current.endHour - current.startHour + 1 < ANOMALY_MAX_WINDOW_HOURS
    ) {
      current.endHour = candidate.hour;
      current.excess += excess;
      current.usageKwh += candidate.value;
      current.baselineKwh += candidate.baseline;
    } else {
      if (current) windows.push(current);
      current = {
        startHour: candidate.hour,
        endHour: candidate.hour,
        excess,
        usageKwh: candidate.value,
        baselineKwh: candidate.baseline
      };
    }
  }
  if (current) windows.push(current);

  windows.sort((a, b) => b.excess - a.excess);
  const strongest = windows[0];

  const startAt = `${today}T${pad2(strongest.startHour)}:00:00`;
  const endAt = `${today}T${pad2(strongest.endHour + 1)}:00:00`;

  const overlapping = await adminSupabaseFetch<Array<{ starts_at: string; ends_at: string }>>(
    `/usage_activities?select=starts_at,ends_at&connection_id=eq.${encodeURIComponent(connectionId)}&ends_at=gt.${startAt}&starts_at=lt.${endAt}`
  );
  const windowMs = naiveLocalMs(endAt) - naiveLocalMs(startAt);
  const alreadyExplained = overlapping.some((activity) => {
    const overlapStart = Math.max(naiveLocalMs(activity.starts_at), naiveLocalMs(startAt));
    const overlapEnd = Math.min(naiveLocalMs(activity.ends_at), naiveLocalMs(endAt));
    const overlapMs = Math.max(0, overlapEnd - overlapStart);
    return windowMs > 0 && overlapMs / windowMs >= ANOMALY_OVERLAP_FRACTION;
  });
  if (alreadyExplained) {
    return;
  }

  const context = {
    startAt,
    endAt,
    usageKwh: round2(strongest.usageKwh),
    baselineKwh: round2(strongest.baselineKwh)
  };
  await evaluateDedupScopedAlert(rule, userId, connectionId, strongest.excess, true, { periodDate: today }, context);
}

// The post-successful-sync hook. Called from both /api/sync (manual) and
// /api/cron/auto-sync (automatic) right after runLivemopaySync() resolves --
// rollups and dashboard_summary are guaranteed fresh at that point, since
// the rollup-refresh trigger fires synchronously inside finish_capture_run's
// own UPDATE statement (see refresh_livenopay_rollups_for_run). Never
// throws: an alert-evaluation failure must not affect the sync's own
// success/failure, so every error is caught and logged here, not
// propagated. Each family below is its own try/catch -- a tariff-profile
// hiccup or an anomaly-detection failure must never prevent low_balance/
// daily_spend/daily_kwh (the original, most-relied-on alerts) from
// evaluating normally, and vice versa.
async function recordAlertDiagnostics(connectionId: string, family: string, error?: unknown) {
  try {
    await reportAlertEvaluationOutcome(connectionId, family, error);
  } catch {
    // The operational feed is best-effort and must never change alert or sync
    // behavior, including during a deployment before its migration lands.
  }
}

export async function evaluateAlertsAfterSync(connectionId: string, userId: string): Promise<void> {
  // The Alerts feature is fully revocable: while off for this user, no new
  // alert_events get written and no push gets sent (push only ever happens
  // inside the insert paths below), but nothing already stored is touched --
  // restoring access resumes evaluation from here with existing rules/state
  // intact.
  if (!(await hasFeatureAccess(userId, "alerts"))) {
    return;
  }

  const now = new Date();
  const today = currentLocalDateString(now);

  let ruleByType = new Map<AlertType, AlertRuleRow>();
  try {
    const rules = await adminSupabaseFetch<AlertRuleRow[]>(
      `/alert_rules?select=${RULE_SELECT}&connection_id=eq.${encodeURIComponent(connectionId)}&enabled=eq.true&type=in.(${FRESH_DATA_ALERT_TYPES.join(",")})`
    );
    ruleByType = new Map(rules.map((rule) => [rule.type, rule]));
    await recordAlertDiagnostics(connectionId, "rules");
  } catch (error) {
    console.error(
      "newinmeter_alert_rules_fetch_failed",
      connectionId,
      error instanceof Error ? error.message : String(error)
    );
    await recordAlertDiagnostics(connectionId, "rules", error);
  }

  try {
    await evaluateBalanceAndSpendFamily(ruleByType, connectionId, userId, today, now);
    await recordAlertDiagnostics(connectionId, "balance-and-spend");
  } catch (error) {
    console.error(
      "newinmeter_alert_balance_spend_family_failed",
      connectionId,
      error instanceof Error ? error.message : String(error)
    );
    await recordAlertDiagnostics(connectionId, "balance-and-spend", error);
  }

  try {
    await evaluateTariffFamily(ruleByType, connectionId, userId, today, now);
    await recordAlertDiagnostics(connectionId, "tariff");
  } catch (error) {
    console.error(
      "newinmeter_alert_tariff_family_failed",
      connectionId,
      error instanceof Error ? error.message : String(error)
    );
    await recordAlertDiagnostics(connectionId, "tariff", error);
  }

  try {
    await evaluateUsageAnomalyFamily(ruleByType.get("usage_anomaly"), connectionId, userId, today);
    await recordAlertDiagnostics(connectionId, "usage-anomaly");
  } catch (error) {
    console.error(
      "newinmeter_alert_usage_anomaly_failed",
      connectionId,
      error instanceof Error ? error.message : String(error)
    );
    await recordAlertDiagnostics(connectionId, "usage-anomaly", error);
  }

  try {
    await resolveDataDelayedIfActive(connectionId);
    await recordAlertDiagnostics(connectionId, "data-delayed");
  } catch (error) {
    console.error(
      "newinmeter_alert_data_delayed_resolve_failed",
      connectionId,
      error instanceof Error ? error.message : String(error)
    );
    await recordAlertDiagnostics(connectionId, "data-delayed", error);
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

// A rounded, human-friendly starting point for the monthly_budget input --
// never persisted, never auto-applied; Settings just pre-fills the field
// with this so the user isn't staring at a blank Rand amount. Prefers the
// previous *complete* SAST calendar month's total spend (a real, finished
// number); falls back to the trailing ~30 days' spend when there's no full
// previous month yet (e.g. a brand new connection). Returns null when
// there's simply not enough history for either -- Settings leaves the field
// empty rather than showing a made-up number.
export async function getSuggestedMonthlyBudget(userId: string): Promise<number | null> {
  const connectionRow = await getConnectionRowForUser(userId);
  if (!connectionRow) return null;

  const now = new Date();
  const today = currentLocalDateString(now);
  const monthKey = currentLocalMonthString(now);
  const monthStart = `${monthKey}-01`;
  const previousMonthEnd = addDaysToDateString(monthStart, -1);
  const previousMonthStart = `${previousMonthEnd.slice(0, 7)}-01`;
  const trailingStart = addDaysToDateString(today, -30);

  const rows = await adminSupabaseFetch<
    Array<{ period_date: string; total_spend: number | string; is_complete: boolean }>
  >(
    `/energy_day_rollups?select=period_date,total_spend,is_complete&connection_id=eq.${encodeURIComponent(connectionRow.id)}&period_date=gte.${previousMonthStart}&period_date=lt.${today}&order=period_date.asc`
  );

  const previousMonthRows = rows.filter(
    (row) => row.is_complete && row.period_date >= previousMonthStart && row.period_date < monthStart
  );
  if (previousMonthRows.length >= 20) {
    const total = previousMonthRows.reduce((sum, row) => sum + (toNumber(row.total_spend) ?? 0), 0);
    return roundToFriendlyRand(total);
  }

  const trailingRows = rows.filter((row) => row.is_complete && row.period_date >= trailingStart);
  if (trailingRows.length >= BUDGET_MIN_HISTORY_DAYS) {
    const dailyAverage =
      trailingRows.reduce((sum, row) => sum + (toNumber(row.total_spend) ?? 0), 0) / trailingRows.length;
    return roundToFriendlyRand(dailyAverage * 30);
  }

  return null;
}

function roundToFriendlyRand(value: number): number {
  if (value <= 0) return 0;
  const step = value < 500 ? 50 : value < 2000 ? 100 : 250;
  return Math.round(value / step) * step;
}

export type AlertInsights = {
  runway: { estimatedDaysRemaining: number | null; hasEnoughHistory: boolean };
  budget: { projectedSpend: number | null; hasEnoughHistory: boolean };
  tariff: { currentTariff: number | null };
  band: {
    profile: string | null;
    monthKwh: number;
    nextBandKwh: number | null;
    warningDistanceKwh: number | null;
  };
  anomaly: { learningDaysSoFar: number; minLearningDays: number; hasEnoughHistory: boolean };
};

// One bounded set of reads backing every "secondary insight" line in
// Settings (runway days remaining, projected month spend, current observed
// tariff, band position, anomaly learning progress) -- display only, mirrors
// but never substitutes for the real evaluator logic in
// evaluateBalanceAndSpendFamily/evaluateTariffFamily/
// evaluateUsageAnomalyFamily above. Never throws over a missing connection
// or a data gap -- every field degrades to its own "not enough yet" shape,
// since this only ever feeds a subtle helper-text line, never a hard error
// state.
export async function getAlertInsights(userId: string): Promise<AlertInsights | null> {
  const connectionRow = await getConnectionRowForUser(userId);
  if (!connectionRow) return null;

  const now = new Date();
  const today = currentLocalDateString(now);
  const monthKey = currentLocalMonthString(now);
  const monthStart = `${monthKey}-01`;
  // The earlier of "start of this month" and "far enough back for the
  // runway lookback" -- must cover BOTH the full month-to-date (for
  // monthly_budget/tariff_band_approaching) AND the trailing
  // RUNWAY_LOOKBACK_DAYS complete days (for balance_runway/monthly_budget's
  // own daily-rate average), even when those two ranges don't overlap
  // (e.g. the 2nd of the month still needs several complete days from the
  // previous month for a real average). ISO date strings compare
  // correctly with `<`, so this is a plain min(), not "whichever is later"
  // -- an earlier version of this line had that inverted, which silently
  // truncated the month-to-date window to ~8 days for any evaluation past
  // the 8th of the month.
  const eightDaysAgo = addDaysToDateString(today, -RUNWAY_LOOKBACK_DAYS - 1);
  const since = monthStart < eightDaysAgo ? monthStart : eightDaysAgo;

  const [summaryRow, rollupRows, latestEnergyRow, hourlyRows] = await Promise.all([
    adminSupabaseFetch<Array<{ latest_balance: number | string | null }>>(
      `/dashboard_summary?select=latest_balance&connection_id=eq.${encodeURIComponent(connectionRow.id)}&limit=1`
    ),
    adminSupabaseFetch<DayRollupRow[]>(
      `/energy_day_rollups?select=period_date,total_spend,energy_kwh,is_complete&connection_id=eq.${encodeURIComponent(connectionRow.id)}&period_date=gte.${since}&period_date=lte.${today}&order=period_date.asc`
    ),
    adminSupabaseFetch<Array<{ tariff: number | string }>>(
      `/energy_rows?select=tariff&connection_id=eq.${encodeURIComponent(connectionRow.id)}&charge_kind=eq.energy&order=period_dt.desc&limit=1`
    ),
    adminSupabaseFetch<Array<{ period_date: string; intervals: number }>>(
      `/energy_hourly_rollups?select=period_date,intervals&connection_id=eq.${encodeURIComponent(connectionRow.id)}&period_date=gte.${addDaysToDateString(today, -ANOMALY_LOOKBACK_DAYS)}&period_date=lt.${today}&intervals=gte.2`
    )
  ]);

  const balance = toNumber(summaryRow[0]?.latest_balance ?? null);
  const recentCompleteDays = rollupRows
    .filter((row) => row.is_complete && row.period_date !== today)
    .sort((a, b) => b.period_date.localeCompare(a.period_date))
    .slice(0, RUNWAY_LOOKBACK_DAYS);
  const hasEnoughRecentHistory = recentCompleteDays.length >= RUNWAY_MIN_HISTORY_DAYS;
  const averageDailySpend = hasEnoughRecentHistory
    ? recentCompleteDays.reduce((sum, row) => sum + (toNumber(row.total_spend) ?? 0), 0) / recentCompleteDays.length
    : null;

  const estimatedDaysRemaining =
    hasEnoughRecentHistory && balance !== null && averageDailySpend !== null && averageDailySpend > 0
      ? balance / averageDailySpend
      : null;

  const { dayOfMonth, daysInMonth } = currentLocalMonthProgress(now);
  const hasEnoughBudgetHistory = hasEnoughRecentHistory && dayOfMonth >= BUDGET_MIN_DAY_OF_MONTH;
  const monthToDateSpend = rollupRows
    .filter((row) => row.period_date >= monthStart)
    .reduce((sum, row) => sum + (toNumber(row.total_spend) ?? 0), 0);
  const projectedSpend =
    hasEnoughBudgetHistory && averageDailySpend !== null
      ? monthToDateSpend + averageDailySpend * Math.max(0, daysInMonth - dayOfMonth)
      : null;

  const currentTariff = toNumber(latestEnergyRow[0]?.tariff ?? null);

  const monthKwh = rollupRows
    .filter((row) => row.period_date >= monthStart)
    .reduce((sum, row) => sum + (toNumber(row.energy_kwh) ?? 0), 0);
  const profile = getTariffProfile(connectionRow.tariff_profile ?? null);
  const position = profile ? resolveMonthlyBand(profile, monthKwh) : null;

  const distinctHistoricalDays = new Set(hourlyRows.map((row) => row.period_date)).size;

  return {
    runway: { estimatedDaysRemaining, hasEnoughHistory: hasEnoughRecentHistory },
    budget: { projectedSpend, hasEnoughHistory: hasEnoughBudgetHistory },
    tariff: { currentTariff },
    band: {
      profile: profile?.key ?? null,
      monthKwh,
      nextBandKwh: position?.nextThresholdKwh ?? null,
      warningDistanceKwh: position?.warningDistanceKwh ?? null
    },
    anomaly: {
      learningDaysSoFar: Math.min(distinctHistoricalDays, ANOMALY_MIN_LEARNING_DAYS),
      minLearningDays: ANOMALY_MIN_LEARNING_DAYS,
      hasEnoughHistory: distinctHistoricalDays >= ANOMALY_MIN_LEARNING_DAYS
    }
  };
}

// Called right after an Activity is created (see /api/activities' POST) --
// if the new activity meaningfully overlaps (>= ANOMALY_OVERLAP_FRACTION of
// the EVENT's own window, same threshold and direction as the evaluator's
// own suppression check) an open usage_anomaly event, that event is now
// explained: resolve it (never delete -- it still shows correctly in
// Notification Centre history) so the alert doesn't keep nagging next sync.
// Never throws -- a failure here must not fail Activity creation itself;
// the caller wraps this in its own try/catch regardless, this is just the
// second line of defense.
export async function resolveOverlappingUsageAnomalyEvents(
  connectionId: string,
  activityStartsAt: string,
  activityEndsAt: string
): Promise<void> {
  const [rule] = await adminSupabaseFetch<Array<{ id: string }>>(
    `/alert_rules?select=id&connection_id=eq.${encodeURIComponent(connectionId)}&type=eq.usage_anomaly&limit=1`
  );
  if (!rule) return;

  const openEvents = await adminSupabaseFetch<Array<{ id: string; event_context: Record<string, unknown> | null }>>(
    `/alert_events?select=id,event_context&alert_rule_id=eq.${encodeURIComponent(rule.id)}&resolved_at=is.null`
  );
  if (openEvents.length === 0) return;

  const activityStartMs = naiveLocalMs(activityStartsAt);
  const activityEndMs = naiveLocalMs(activityEndsAt);

  for (const event of openEvents) {
    const startAt = contextString(event.event_context, "startAt");
    const endAt = contextString(event.event_context, "endAt");
    if (!startAt || !endAt) continue;

    const windowStartMs = naiveLocalMs(startAt);
    const windowEndMs = naiveLocalMs(endAt);
    const windowMs = windowEndMs - windowStartMs;
    if (windowMs <= 0) continue;

    const overlapStart = Math.max(windowStartMs, activityStartMs);
    const overlapEnd = Math.min(windowEndMs, activityEndMs);
    const overlapMs = Math.max(0, overlapEnd - overlapStart);

    if (overlapMs / windowMs >= ANOMALY_OVERLAP_FRACTION) {
      await resolveEvent(event.id);
    }
  }
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

  // Same Alerts revocability as evaluateAlertsAfterSync -- a batch cron tick
  // has no per-request session to gate on, so it resolves access itself,
  // one bulk query for the whole batch rather than one per connection.
  const accessByUserId = await getFeatureAccessForUsers(connections.map((c) => c.userId));
  const gatedConnections = connections.filter((c) => accessByUserId.get(c.userId)?.alerts.enabled);

  if (gatedConnections.length === 0) {
    return { checked: 0, notified: 0 };
  }

  const connectionIds = gatedConnections.map((c) => c.connectionId).join(",");
  const rules = await adminSupabaseFetch<AlertRuleRow[]>(
    `/alert_rules?select=${RULE_SELECT}&type=eq.data_delayed&enabled=eq.true&connection_id=in.(${connectionIds})`
  );

  if (rules.length === 0) {
    return { checked: 0, notified: 0 };
  }

  const connectionById = new Map(gatedConnections.map((c) => [c.connectionId, c]));
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
  event_context: Record<string, unknown> | null;
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
    // suppressed=eq.false excludes the losing half of a correlated pair
    // (see the `suppressed` column comment) -- filtered server-side so
    // `limit` still returns `limit` genuinely visible items, not fewer.
    adminSupabaseFetch<AlertEventRow[]>(
      `/alert_events?select=id,alert_rule_id,triggered_at,trigger_value,threshold_value,read_at,event_context&connection_id=eq.${encodeURIComponent(connectionRow.id)}&suppressed=eq.false&order=triggered_at.desc&limit=${limit}`
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
    const copy = notifyCopyFor({ type, threshold: event.threshold_value, context: event.event_context }, currentValue);

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

export type AlertEventDetail = {
  id: string;
  type: AlertType;
  title: string;
  body: string;
  navigateUrl: string;
  triggeredAt: string;
  triggerValue: number;
  thresholdValue: number | null;
  context: Record<string, unknown> | null;
  resolvedAt: string | null;
  isRead: boolean;
};

// Backs the assistant's explain_alert tool and the "Ask AI" notification
// deep link -- everything needed to explain one specific alert event.
// Ownership is enforced by the query itself (connection_id filter resolved
// from the authenticated userId, never from the caller's eventId): an id
// belonging to another user's connection matches zero rows and returns
// null, same "not found" shape as a genuinely bad id, so this never leaks
// whether the id exists at all. Reuses notifyCopyFor -- the exact same
// title/body the push notification and notification centre already show --
// and event_context, which already carries the type-specific numbers the
// evaluator itself computed at trigger time (see the evaluator families
// above), so this never recomputes or approximates evaluator semantics.
export async function getAlertEventDetail(userId: string, eventId: string): Promise<AlertEventDetail | null> {
  const connectionRow = await getConnectionRowForUser(userId);
  if (!connectionRow) {
    return null;
  }

  const [event] = await adminSupabaseFetch<Array<AlertEventRow & { resolved_at: string | null }>>(
    `/alert_events?select=id,alert_rule_id,triggered_at,trigger_value,threshold_value,read_at,event_context,resolved_at&id=eq.${encodeURIComponent(eventId)}&connection_id=eq.${encodeURIComponent(connectionRow.id)}&limit=1`
  );
  if (!event) {
    return null;
  }

  const [rule] = await adminSupabaseFetch<Array<{ type: AlertType }>>(
    `/alert_rules?select=type&id=eq.${encodeURIComponent(event.alert_rule_id)}&limit=1`
  );
  if (!rule) {
    return null;
  }

  const currentValue = toNumber(event.trigger_value) ?? 0;
  const copy = notifyCopyFor(
    { type: rule.type, threshold: event.threshold_value, context: event.event_context },
    currentValue
  );

  return {
    id: event.id,
    type: rule.type,
    title: copy.title,
    body: copy.body,
    navigateUrl: copy.url,
    triggeredAt: event.triggered_at,
    triggerValue: currentValue,
    thresholdValue: toNumber(event.threshold_value),
    context: event.event_context,
    resolvedAt: event.resolved_at,
    isRead: event.read_at !== null
  };
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
    `/alert_events?connection_id=eq.${encodeURIComponent(connectionRow.id)}&read_at=is.null&suppressed=eq.false`
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
    `/alert_events?connection_id=eq.${encodeURIComponent(connectionRow.id)}&read_at=is.null&suppressed=eq.false`,
    { read_at: new Date().toISOString() },
    "return=representation"
  );

  return rows.length;
}
