// One-time backfill: assigns every existing (pre-multi-user) energy_rows,
// capture_runs, rollup, and dashboard_summary row to a single Supabase Auth
// user's LiveMopay connection. Run this after applying migrations
// 20260725000000-20260725015000 and before 20260725020000
// (newinmeter_enforce_ownership), which requires connection_id to already be
// backfilled everywhere.
//
// Usage:
//   LEGACY_OWNER_USER_ID=<uuid> LEGACY_OWNER_LIVEMOPAY_EMAIL=<email> \
//     npm run backfill:legacy-owner -- --confirm
//
// Without --confirm this only prints what it would do and makes no changes.
// Safe to re-run: the underlying updates only touch rows where
// connection_id is still null, and reuses an existing legacy connection row
// instead of creating a duplicate.

import { adminSupabaseCount, adminSupabaseRequest } from "@/lib/supabase-rest";
import { createSupabaseAdminClient } from "@/lib/supabase/admin-client";

type ConnectionRow = { id: string; user_id: string; status: string };

type BackfillResult = {
  energy_rows_updated: number;
  capture_runs_updated: number;
  day_rollups_updated: number;
  hourly_rollups_updated: number;
  interval_rollups_updated: number;
  dashboard_summary_updated: number;
};

const COUNT_TARGETS: Array<{ label: string; path: string }> = [
  { label: "energy_rows", path: "/energy_rows?select=id&connection_id=is.null&limit=1" },
  { label: "capture_runs", path: "/capture_runs?select=id&connection_id=is.null&limit=1" },
  { label: "energy_day_rollups", path: "/energy_day_rollups?select=period_date&connection_id=is.null&limit=1" },
  { label: "energy_hourly_rollups", path: "/energy_hourly_rollups?select=period_date&connection_id=is.null&limit=1" },
  {
    label: "energy_interval_rollups",
    path: "/energy_interval_rollups?select=period_date&connection_id=is.null&limit=1"
  },
  { label: "dashboard_summary", path: "/dashboard_summary?select=connection_id&connection_id=is.null&limit=1" }
];

async function printNullOwnerCounts(heading: string) {
  console.log(`\n${heading}`);
  let anyRemaining = false;

  for (const target of COUNT_TARGETS) {
    const count = await adminSupabaseCount(target.path);
    console.log(`  ${target.label}: ${count} row(s) with connection_id is null`);
    if (count > 0) {
      anyRemaining = true;
    }
  }

  return anyRemaining;
}

class MultipleLegacyConnectionsError extends Error {}

// Deterministic, exhaustive lookup -- not limit=1 -- so a rerun after a
// failed/timed-out attempt always finds and reuses whatever this script
// already created, and so this refuses to guess rather than silently
// picking one if more than one row somehow exists for this user (there is
// no database constraint preventing multiple 'disconnected' rows for the
// same user_id, since the partial unique index only covers
// 'connected'/'pending_selection').
async function findOrCreateLegacyConnection(userId: string, livemopayEmail: string): Promise<ConnectionRow> {
  const existing = await adminSupabaseRequest<ConnectionRow[]>(
    "GET",
    `/livemopay_connections?select=id,user_id,status,connected_at&user_id=eq.${encodeURIComponent(userId)}&order=connected_at.asc`
  );

  if (existing.length > 1) {
    const ids = existing.map((row) => `${row.id} (${row.status})`).join(", ");
    throw new MultipleLegacyConnectionsError(
      `Refusing to guess: ${existing.length} connections already exist for this user: ${ids}. ` +
        "Resolve manually (decide which one should own the legacy data, delete or reassign the " +
        "others) before rerunning."
    );
  }

  if (existing[0]) {
    console.log(`Reusing existing connection ${existing[0].id} (status: ${existing[0].status}) for this user.`);
    return existing[0];
  }

  // No tokens are written here -- this row starts disconnected. The owner
  // signs in and completes /connect afterward, which will find and reuse
  // this same row (matched by user_id) rather than creating a second one,
  // so the ledger history stays attached to one connection_id throughout.
  const created = await adminSupabaseRequest<ConnectionRow[]>(
    "POST",
    "/livemopay_connections",
    [
      {
        user_id: userId,
        livemopay_email: livemopayEmail,
        status: "disconnected"
      }
    ],
    "return=representation"
  );

  console.log(`Created legacy connection ${created[0].id} (status: disconnected, no tokens).`);
  return created[0];
}

async function main() {
  const confirm = process.argv.includes("--confirm");
  const legacyOwnerUserId = process.env.LEGACY_OWNER_USER_ID;
  const legacyOwnerEmail = process.env.LEGACY_OWNER_LIVEMOPAY_EMAIL;

  if (!legacyOwnerUserId) {
    console.error("Refusing to run: LEGACY_OWNER_USER_ID is not set.");
    process.exitCode = 1;
    return;
  }

  if (!legacyOwnerEmail) {
    console.error("Refusing to run: LEGACY_OWNER_LIVEMOPAY_EMAIL is not set.");
    process.exitCode = 1;
    return;
  }

  const admin = createSupabaseAdminClient();
  const { data: userLookup, error: userLookupError } = await admin.auth.admin.getUserById(legacyOwnerUserId);

  if (userLookupError || !userLookup?.user) {
    console.error(
      `Refusing to guess the owner: no Supabase Auth user found for LEGACY_OWNER_USER_ID=${legacyOwnerUserId}.`
    );
    process.exitCode = 1;
    return;
  }

  console.log(`Legacy owner: ${userLookup.user.email ?? legacyOwnerUserId} (${legacyOwnerUserId})`);

  const hadNullOwnersBefore = await printNullOwnerCounts("Rows with no owner (before):");

  if (!hadNullOwnersBefore) {
    console.log("\nNothing to backfill -- every row already has an owner.");
    return;
  }

  if (!confirm) {
    console.log("\nDry run only (pass --confirm to apply). No changes made.");
    return;
  }

  const connection = await findOrCreateLegacyConnection(legacyOwnerUserId, legacyOwnerEmail);

  const { data: rpcData, error: rpcError } = await admin
    .rpc("backfill_legacy_owner_data", {
      p_connection_id: connection.id,
      p_user_id: legacyOwnerUserId
    })
    .single();

  if (rpcError) {
    console.error(`Backfill failed: ${rpcError.message}`);
    process.exitCode = 1;
    return;
  }

  const result = rpcData as BackfillResult;

  console.log("\nRows updated by the backfill transaction:");
  console.log(`  energy_rows: ${result.energy_rows_updated}`);
  console.log(`  capture_runs: ${result.capture_runs_updated}`);
  console.log(`  energy_day_rollups: ${result.day_rollups_updated}`);
  console.log(`  energy_hourly_rollups: ${result.hourly_rollups_updated}`);
  console.log(`  energy_interval_rollups: ${result.interval_rollups_updated}`);
  console.log(`  dashboard_summary: ${result.dashboard_summary_updated}`);

  const hasNullOwnersAfter = await printNullOwnerCounts("Rows with no owner (after):");

  if (hasNullOwnersAfter) {
    console.error(
      "\nFAIL: rows with a null connection_id remain. Do not apply " +
        "20260725020000_newinmeter_enforce_ownership.sql until this is resolved -- " +
        "it will fail on the NOT NULL constraint, which is the intended safety behavior."
    );
    process.exitCode = 1;
    return;
  }

  console.log("\nOK: every row now has an owner. Safe to apply the remaining migrations.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
