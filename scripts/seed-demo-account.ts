// Provisions (or resets) the shared recruiter/demo NewinMeter account:
// finds-or-creates a Supabase Auth user, marks (or reuses) a
// livemopay_connections row as is_demo, wipes and reseeds ~10 weeks of
// synthetic energy/water/Activities data for that connection, and runs the
// same rollup-refresh path a real sync uses (finish_capture_run RPC ->
// capture_runs trigger -> refresh_newinmeter_rollups_for_run) so the
// dashboard, analytics, and assistant see this connection exactly like a
// real one, minus any LiveMopay credential.
//
// Safe to rerun: it only ever deletes/reinserts rows scoped to this one
// connection_id, and refuses to touch an existing connection unless it is
// already marked is_demo -- an email collision with a real account aborts
// loudly instead of silently converting it.
//
// Usage:
//   NEWINMETER_DEMO_EMAIL=demo@example.com npm run seed:demo-account
//
// Requires the same Supabase service-role env vars as the app
// (SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SUPABASE_URL) -- see .env.local.
//
// This account has no password. Recruiter sign-in goes through
// /api/demo-login (a server-generated Supabase magic link, gated by
// NEWINMETER_DEMO_ACCESS_TOKEN), the exact same magic-link mechanism every
// other NewinMeter account uses -- see the README "Demo account" section.

import { buildDemoDataset } from "@/lib/demo/dataset";
import { adminSupabaseRequest } from "@/lib/supabase-rest";
import { createSupabaseAdminClient } from "@/lib/supabase/admin-client";
import { validateDemoSeedTarget } from "@/lib/demo/seed-safety";

const DEMO_LIVEMOPAY_EMAIL = "demo.recruiter@newinmeter.invalid";
const DEMO_ACCOUNT_ID = "demo-account-001";
const DEMO_COMPANY_ID = "demo-company-001";
const DEMO_PROPERTY_ID = "demo-property-001";
const DEMO_ACCOUNT_LABEL = "Demo Property (Newinbosch)";
const DATASET_DAYS = 70; // ~10 weeks

type ConnectionRow = { id: string; user_id: string; is_demo: boolean; status: string };

function isoYesterday() {
  const now = new Date();
  const yesterday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
  return yesterday.toISOString().slice(0, 10);
}

function addDaysIso(isoDate: string, days: number) {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

async function findOrCreateDemoAuthUser(email: string) {
  const admin = createSupabaseAdminClient();

  // Single page, matching the same simplification listAllUserPermissions()
  // already makes for this app's user count -- see src/lib/user-roles.ts.
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (error) {
    throw new Error(`Could not list Supabase Auth users: ${error.message}`);
  }

  const existing = data.users.find((user) => user.email?.toLowerCase() === email.toLowerCase());

  if (existing) {
    console.log(`Reusing existing Supabase Auth user ${existing.id} (${email}).`);
    // No password is ever set for this account -- sign-in goes exclusively
    // through /api/demo-login's server-generated magic link, the same
    // mechanism every other NewinMeter account already uses. Just make sure
    // a previously-unconfirmed row (shouldn't happen, but cheap to check)
    // doesn't block generateLink().
    if (!existing.email_confirmed_at) {
      const { data: updated, error: updateError } = await admin.auth.admin.updateUserById(existing.id, {
        email_confirm: true
      });
      if (updateError || !updated.user) {
        throw new Error(`Could not confirm the demo auth user's email: ${updateError?.message}`);
      }
      return updated.user;
    }
    return existing;
  }

  console.log(`Creating Supabase Auth user for ${email}.`);
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    email_confirm: true
  });
  if (createError || !created.user) {
    throw new Error(`Could not create the demo auth user: ${createError?.message}`);
  }
  return created.user;
}

async function findOrCreateDemoConnection(userId: string): Promise<ConnectionRow> {
  const existingRows = await adminSupabaseRequest<ConnectionRow[]>(
    "GET",
    `/livemopay_connections?select=id,user_id,is_demo,status&user_id=eq.${encodeURIComponent(userId)}&order=connected_at.asc`
  );

  const existing = validateDemoSeedTarget(existingRows);

  const nowIso = new Date().toISOString();
  const payload = {
    user_id: userId,
    livemopay_email: DEMO_LIVEMOPAY_EMAIL,
    firebase_local_id: null,
    account_id: DEMO_ACCOUNT_ID,
    company_id: DEMO_COMPANY_ID,
    property_id: DEMO_PROPERTY_ID,
    account_label: DEMO_ACCOUNT_LABEL,
    // Never set: a demo connection carries no LiveMopay credential, ever.
    refresh_token_ciphertext: null,
    refresh_token_iv: null,
    refresh_token_auth_tag: null,
    pending_accounts: null,
    status: "connected",
    is_demo: true,
    auto_sync_enabled: false,
    next_sync_at: null,
    last_synced_at: nowIso,
    last_auto_sync_at: null,
    last_auto_sync_status: null,
    last_auto_sync_error: null,
    sync_claimed_at: null,
    stale_notified_at: null,
    alerts_enabled: true,
    tariff_profile: null,
    last_error: null,
    updated_at: nowIso
  };

  if (existing) {
    const rows = await adminSupabaseRequest<ConnectionRow[]>(
      "PATCH",
      `/livemopay_connections?id=eq.${encodeURIComponent(existing.id)}`,
      payload,
      "return=representation"
    );
    console.log(`Reusing existing demo connection ${rows[0].id}.`);
    return rows[0];
  }

  const rows = await adminSupabaseRequest<ConnectionRow[]>(
    "POST",
    "/livemopay_connections",
    [{ ...payload, connected_at: nowIso }],
    "return=representation"
  );
  console.log(`Created demo connection ${rows[0].id}.`);
  return rows[0];
}

async function wipeConnectionData(connectionId: string, userId: string) {
  const path = (table: string) => `/${table}?connection_id=eq.${encodeURIComponent(connectionId)}`;
  for (const table of [
    "energy_rows",
    "capture_runs",
    "energy_day_rollups",
    "energy_hourly_rollups",
    "energy_interval_rollups",
    "dashboard_summary",
    "usage_activities",
    // Cascades alert_events and alert_rule_state.
    "alert_rules"
  ]) {
    await adminSupabaseRequest("DELETE", path(table), undefined, "return=minimal");
  }
  await adminSupabaseRequest(
    "DELETE",
    `/push_subscriptions?user_id=eq.${encodeURIComponent(userId)}`,
    undefined,
    "return=minimal"
  );
  console.log("Cleared prior demo data for this connection.");
}

const DEMO_ALERT_RULE_IDS = {
  dailyKwh: "00000000-0000-4000-8000-000000000101",
  usageAnomaly: "00000000-0000-4000-8000-000000000102",
  tariffChanged: "00000000-0000-4000-8000-000000000103",
  monthlyBudget: "00000000-0000-4000-8000-000000000104"
} as const;

async function seedAlerts(connectionId: string, dataset: ReturnType<typeof buildDemoDataset>) {
  const rules = [
    { id: DEMO_ALERT_RULE_IDS.dailyKwh, type: "daily_kwh", enabled: true, threshold: 17 },
    { id: DEMO_ALERT_RULE_IDS.usageAnomaly, type: "usage_anomaly", enabled: true, threshold: null },
    { id: DEMO_ALERT_RULE_IDS.tariffChanged, type: "tariff_changed", enabled: true, threshold: null },
    { id: DEMO_ALERT_RULE_IDS.monthlyBudget, type: "monthly_budget", enabled: true, threshold: 1450 }
  ].map((rule) => ({ ...rule, connection_id: connectionId }));
  await adminSupabaseRequest("POST", "/alert_rules", rules, "return=minimal");

  const highDate = dataset.meta.highUsageDates[dataset.meta.highUsageDates.length - 1];
  const highUsage = dataset.energyRows
    .filter((row) => row.periodDt.startsWith(highDate) && row.chargeLabel.startsWith("Energy Charge:"))
    .reduce((sum, row) => sum + row.kwh, 0);
  const events = [
    {
      id: "00000000-0000-4000-8000-000000000201",
      alert_rule_id: DEMO_ALERT_RULE_IDS.tariffChanged,
      triggered_at: `${dataset.meta.rateChangeDate}T06:00:00+02:00`,
      trigger_value: dataset.meta.baseRateAfter,
      threshold_value: null,
      event_context: { previousTariff: dataset.meta.baseRateBefore, currentTariff: dataset.meta.baseRateAfter },
      read_at: `${dataset.meta.rateChangeDate}T08:30:00+02:00`,
      resolved_at: `${dataset.meta.rateChangeDate}T08:30:00+02:00`
    },
    {
      id: "00000000-0000-4000-8000-000000000202",
      alert_rule_id: DEMO_ALERT_RULE_IDS.usageAnomaly,
      period_date: dataset.meta.spikeDate,
      triggered_at: `${dataset.meta.spikeDate}T03:05:00+02:00`,
      trigger_value: 4.8,
      threshold_value: null,
      event_context: {
        startAt: `${dataset.meta.spikeDate}T02:00:00`,
        endAt: `${dataset.meta.spikeDate}T03:00:00`
      },
      read_at: null
    },
    {
      id: "00000000-0000-4000-8000-000000000203",
      alert_rule_id: DEMO_ALERT_RULE_IDS.dailyKwh,
      period_date: highDate,
      triggered_at: `${highDate}T22:00:00+02:00`,
      trigger_value: Math.round(highUsage * 100) / 100,
      threshold_value: 17,
      event_context: null,
      read_at: null
    }
  ].map((event) => ({
    ...event,
    connection_id: connectionId,
    period_date: "period_date" in event ? event.period_date : null,
    dedup_key: null,
    notification_sent_at: event.triggered_at,
    suppressed: false,
    resolved_at: "resolved_at" in event ? event.resolved_at : null
  }));
  await adminSupabaseRequest("POST", "/alert_events", events, "return=minimal");
  console.log(`Inserted ${rules.length} alert rules and ${events.length} notification events.`);
}

async function seedEnergyRows(connectionId: string, rows: ReturnType<typeof buildDemoDataset>["energyRows"]) {
  const runRows = await adminSupabaseRequest<Array<{ id: string }>>(
    "POST",
    "/capture_runs",
    [{ connection_id: connectionId, mode: "full", status: "running" }],
    "return=representation"
  );
  const runId = runRows[0].id;

  const BATCH_SIZE = 500;
  for (let index = 0; index < rows.length; index += BATCH_SIZE) {
    const batch = rows.slice(index, index + BATCH_SIZE).map((row) => ({
      connection_id: connectionId,
      sync_run_id: runId,
      capture_dt: row.captureDt,
      charge_label: row.chargeLabel,
      period_dt: row.periodDt,
      kwh: row.kwh,
      water_kl: row.waterKl,
      tariff: row.tariff,
      tariff_band: row.tariffBand,
      cost: row.cost,
      balance: row.balance
    }));
    await adminSupabaseRequest("POST", "/energy_rows", batch, "return=minimal");
  }
  console.log(`Inserted ${rows.length} energy_rows.`);

  // Same finish path a real sync uses: this fires
  // capture_runs_refresh_rollups_update, which calls
  // refresh_newinmeter_rollups_for_run -- the demo's day/hourly/interval
  // rollups and dashboard_summary are computed by the real production
  // function, not hand-derived here.
  await adminSupabaseRequest(
    "POST",
    "/rpc/finish_capture_run",
    { p_run_id: runId, p_status: "success", p_rows_synced: rows.length, p_error: null },
    "return=minimal"
  );
  console.log("Rollups refreshed via finish_capture_run/refresh_newinmeter_rollups_for_run.");
}

async function seedActivities(connectionId: string, activities: ReturnType<typeof buildDemoDataset>["activities"]) {
  const payload = activities.map((activity) => ({
    connection_id: connectionId,
    starts_at: activity.startsAt,
    ends_at: activity.endsAt,
    all_day: activity.allDay,
    tags: activity.tags,
    color: activity.color,
    note: activity.note ?? null
  }));
  await adminSupabaseRequest("POST", "/usage_activities", payload, "return=minimal");
  console.log(`Inserted ${payload.length} usage_activities.`);
}

async function seedDemoProductState(userId: string) {
  const updatedAt = new Date().toISOString();
  await adminSupabaseRequest(
    "POST",
    "/user_roles?on_conflict=user_id",
    [{ user_id: userId, role: "user" }],
    "resolution=merge-duplicates,return=minimal"
  );
  await adminSupabaseRequest(
    "POST",
    "/feature_overrides?on_conflict=user_id,feature_key",
    [
      { user_id: userId, feature_key: "ai", enabled: true, updated_at: updatedAt },
      { user_id: userId, feature_key: "activities", enabled: true, updated_at: updatedAt },
      { user_id: userId, feature_key: "alerts", enabled: true, updated_at: updatedAt },
      { user_id: userId, feature_key: "live", enabled: false, updated_at: updatedAt }
    ],
    "resolution=merge-duplicates,return=minimal"
  );
}

async function main() {
  const email = process.env.NEWINMETER_DEMO_EMAIL;

  if (!email) {
    console.error("Refusing to run: NEWINMETER_DEMO_EMAIL is not set.");
    process.exitCode = 1;
    return;
  }

  const user = await findOrCreateDemoAuthUser(email);
  const connection = await findOrCreateDemoConnection(user.id);

  await wipeConnectionData(connection.id, user.id);

  const startDate = addDaysIso(isoYesterday(), -(DATASET_DAYS - 1));
  const dataset = buildDemoDataset({ startDate, days: DATASET_DAYS });

  await seedEnergyRows(connection.id, dataset.energyRows);
  await seedActivities(connection.id, dataset.activities);
  await seedAlerts(connection.id, dataset);

  // Explicit overrides make the walkthrough stable even if global rollout
  // modes change later. Live stays intentionally unavailable because no
  // physical meter is attached to this synthetic account.
  await seedDemoProductState(user.id);
  console.log("Set user role and canonical demo feature overrides (AI/Activities/Alerts on, Live off).");

  console.log("\nDemo account ready:");
  console.log(`  email: ${email}`);
  console.log(`  user id: ${user.id}`);
  console.log(`  connection id: ${connection.id}`);
  console.log(`  date range: ${dataset.meta.startDate} to ${dataset.meta.endDate} (${dataset.meta.days} days)`);
  console.log(`  energy rows: ${dataset.energyRows.length}`);
  console.log(`  activities: ${dataset.activities.length}`);
  console.log(
    `  tariff change: ${dataset.meta.rateChangeDate} (R${dataset.meta.baseRateBefore} -> R${dataset.meta.baseRateAfter}/kWh)`
  );
  console.log(`  spike day: ${dataset.meta.spikeDate}`);
  console.log(`  refund: ${dataset.meta.refundDate}`);
  console.log(`  top-ups: ${dataset.meta.topupDates.join(", ")}`);
  console.log(`  final balance: R${dataset.energyRows[dataset.energyRows.length - 1].balance.toFixed(2)}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
