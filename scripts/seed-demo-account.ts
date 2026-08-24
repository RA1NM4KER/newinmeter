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
import { setUserFeatureOverride } from "@/lib/features";
import { setUserRole } from "@/lib/user-roles";

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

  if (existingRows.length > 1) {
    throw new Error(
      `Refusing to guess: ${existingRows.length} connections already exist for this user. Resolve manually before rerunning.`
    );
  }

  const existing = existingRows[0];

  if (existing && !existing.is_demo) {
    throw new Error(
      `Refusing to overwrite connection ${existing.id}: it exists but is not marked is_demo. ` +
        "NEWINMETER_DEMO_EMAIL must point at a dedicated demo account, never a real user's email."
    );
  }

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

async function wipeConnectionData(connectionId: string) {
  const path = (table: string) => `/${table}?connection_id=eq.${encodeURIComponent(connectionId)}`;
  for (const table of [
    "energy_rows",
    "capture_runs",
    "energy_day_rollups",
    "energy_hourly_rollups",
    "energy_interval_rollups",
    "dashboard_summary",
    "usage_activities"
  ]) {
    await adminSupabaseRequest("DELETE", path(table), undefined, "return=minimal");
  }
  console.log("Cleared prior demo data for this connection.");
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

async function main() {
  const email = process.env.NEWINMETER_DEMO_EMAIL;

  if (!email) {
    console.error("Refusing to run: NEWINMETER_DEMO_EMAIL is not set.");
    process.exitCode = 1;
    return;
  }

  const user = await findOrCreateDemoAuthUser(email);
  const connection = await findOrCreateDemoConnection(user.id);

  await wipeConnectionData(connection.id);

  const startDate = addDaysIso(isoYesterday(), -(DATASET_DAYS - 1));
  const dataset = buildDemoDataset({ startDate, days: DATASET_DAYS });

  await seedEnergyRows(connection.id, dataset.energyRows);
  await seedActivities(connection.id, dataset.activities);

  await setUserRole(user.id, "user");
  // AI is on for everyone by default (rollout mode 'everyone'); Activities
  // defaults off ('selected'), so the demo account needs an explicit grant.
  await setUserFeatureOverride(user.id, "activities", true);
  console.log("Set user_roles: role=user. Granted the demo account an explicit Activities override.");

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
