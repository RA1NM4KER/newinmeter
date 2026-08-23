import "server-only";

import { randomUUID } from "node:crypto";
import { cache } from "react";
import { adminSupabaseFetch, adminSupabaseRequest } from "../supabase-rest";
import { createSupabaseAdminClient } from "../supabase/admin-client";
import { decryptRefreshToken, encryptRefreshToken } from "../token-encryption";
import { computeAutoSyncRetryAt, computeNextAutoSyncAt } from "./schedule";
import type { LiveMopayAccountCandidate } from "./web";

export type ConnectionStatus = "connected" | "pending_selection" | "disconnected" | "error";

// Thrown by every mutation that would destroy or repoint the shared demo
// connection (reconnect, disconnect, account delete). This is the backstop
// -- route handlers also check connection.isDemo themselves for a clean
// 403, but a demo-aware check lives here too so no future caller of these
// functions can bypass it by skipping the route-level check.
export class DemoAccountProtectedError extends Error {
  constructor(action: string) {
    super(`Demo account: ${action} is disabled for the shared demo connection.`);
    this.name = "DemoAccountProtectedError";
  }
}

type ConnectionRow = {
  id: string;
  user_id: string;
  livemopay_email: string;
  firebase_local_id: string | null;
  account_id: string | null;
  company_id: string | null;
  property_id: string | null;
  account_label: string | null;
  refresh_token_ciphertext: string | null;
  refresh_token_iv: string | null;
  refresh_token_auth_tag: string | null;
  pending_accounts: LiveMopayAccountCandidate[] | null;
  status: ConnectionStatus;
  connected_at: string;
  updated_at: string;
  last_synced_at: string | null;
  last_error: string | null;
  is_demo: boolean;
  auto_sync_enabled: boolean;
  next_sync_at: string | null;
  last_auto_sync_at: string | null;
  last_auto_sync_status: "success" | "failed" | null;
  last_auto_sync_error: string | null;
  sync_claimed_at: string | null;
  alerts_enabled: boolean;
};

export type LivemopayConnection = {
  id: string;
  userId: string;
  livemopayEmail: string;
  accountId: string | null;
  companyId: string | null;
  propertyId: string | null;
  accountLabel: string | null;
  status: ConnectionStatus;
  pendingAccounts: LiveMopayAccountCandidate[] | null;
  connectedAt: string;
  lastSyncedAt: string | null;
  lastError: string | null;
  // Marks a seeded recruiter/demo connection: real connection-scoped data
  // model, fixed synthetic content, never a real LiveMopay credential. See
  // scripts/seed-demo-account.ts.
  isDemo: boolean;
  autoSyncEnabled: boolean;
  nextSyncAt: string | null;
  lastAutoSyncAt: string | null;
  lastAutoSyncStatus: "success" | "failed" | null;
  lastAutoSyncError: string | null;
  alertsEnabled: boolean;
};

const CONNECTION_SELECT =
  "id,user_id,livemopay_email,firebase_local_id,account_id,company_id,property_id,account_label," +
  "refresh_token_ciphertext,refresh_token_iv,refresh_token_auth_tag,pending_accounts,status," +
  "connected_at,updated_at,last_synced_at,last_error,is_demo,auto_sync_enabled,next_sync_at," +
  "last_auto_sync_at,last_auto_sync_status,last_auto_sync_error,sync_claimed_at,alerts_enabled";

function toConnection(row: ConnectionRow): LivemopayConnection {
  return {
    id: row.id,
    userId: row.user_id,
    livemopayEmail: row.livemopay_email,
    accountId: row.account_id,
    companyId: row.company_id,
    propertyId: row.property_id,
    accountLabel: row.account_label,
    status: row.status,
    pendingAccounts: row.pending_accounts,
    connectedAt: row.connected_at,
    lastSyncedAt: row.last_synced_at,
    lastError: row.last_error,
    isDemo: row.is_demo,
    autoSyncEnabled: row.auto_sync_enabled,
    nextSyncAt: row.next_sync_at,
    lastAutoSyncAt: row.last_auto_sync_at,
    lastAutoSyncStatus: row.last_auto_sync_status,
    lastAutoSyncError: row.last_auto_sync_error,
    alertsEnabled: row.alerts_enabled
  };
}

// Service-role read, explicitly filtered by the already-resolved user id --
// livemopay_connections has no authenticated RLS policy (see the connections
// migration), so this is the only way to read it, and ownership is enforced
// here in code rather than by the database for this one table.
export async function getConnectionRowForUser(userId: string): Promise<ConnectionRow | null> {
  const rows = await adminSupabaseFetch<ConnectionRow[]>(
    `/livemopay_connections?select=${CONNECTION_SELECT}&user_id=eq.${encodeURIComponent(userId)}&limit=1`
  );

  return rows[0] ?? null;
}

// cache()'d because the layout and every page under it each call this
// independently -- without it, one navigation hits Supabase for the same
// user's connection 2+ times. Every caller reads this once, before any
// write, within a given request, so there's no stale-after-write risk.
export const getConnectionForUser = cache(async (userId: string): Promise<LivemopayConnection | null> => {
  const row = await getConnectionRowForUser(userId);
  return row ? toConnection(row) : null;
});

export function getDecryptedRefreshToken(
  row: Pick<ConnectionRow, "refresh_token_ciphertext" | "refresh_token_iv" | "refresh_token_auth_tag">
) {
  if (!row.refresh_token_ciphertext || !row.refresh_token_iv || !row.refresh_token_auth_tag) {
    throw new Error("Connection has no stored refresh token.");
  }

  return decryptRefreshToken({
    ciphertext: row.refresh_token_ciphertext,
    iv: row.refresh_token_iv,
    authTag: row.refresh_token_auth_tag
  });
}

export type BeginConnectionParams = {
  userId: string;
  livemopayEmail: string;
  firebaseLocalId?: string;
  refreshToken: string;
  candidates: LiveMopayAccountCandidate[];
};

// Discovery returned exactly one candidate -> connect immediately. More than
// one -> store the full candidate list server-side (pending_accounts) and
// wait for /api/livemopay/select-account. Either way the password never
// reaches this function and the refresh token is encrypted before it's
// written.
export async function beginLivemopayConnection(params: BeginConnectionParams): Promise<LivemopayConnection> {
  const existing = await getConnectionRowForUser(params.userId);

  if (existing?.is_demo) {
    throw new DemoAccountProtectedError("connecting real LiveMopay credentials");
  }

  const encrypted = encryptRefreshToken(params.refreshToken);
  const single = params.candidates.length === 1 ? params.candidates[0] : null;
  const nowIso = new Date().toISOString();
  // Reconnecting keeps whatever auto-sync preference the user already set
  // (defaults true for a genuinely new row -- see the connection-level
  // default). Either way, this call is the "connect/reconnect" transition:
  // becoming connected with auto-sync on always gets a fresh next_sync_at,
  // never a stale one left over from before a disconnect.
  const autoSyncEnabled = existing?.auto_sync_enabled ?? true;
  const connectionId = existing?.id ?? randomUUID();
  const nextSyncAt = single && autoSyncEnabled ? computeNextAutoSyncAt(connectionId, new Date()).toISOString() : null;

  const payload = {
    id: connectionId,
    user_id: params.userId,
    livemopay_email: params.livemopayEmail,
    firebase_local_id: params.firebaseLocalId ?? null,
    account_id: single?.accountId ?? null,
    company_id: single?.companyId ?? null,
    property_id: single?.propertyId ?? null,
    account_label: single?.label ?? null,
    refresh_token_ciphertext: encrypted.ciphertext,
    refresh_token_iv: encrypted.iv,
    refresh_token_auth_tag: encrypted.authTag,
    pending_accounts: single ? null : params.candidates,
    status: single ? "connected" : "pending_selection",
    last_error: null,
    auto_sync_enabled: autoSyncEnabled,
    next_sync_at: nextSyncAt,
    last_auto_sync_status: null,
    last_auto_sync_error: null,
    sync_claimed_at: null,
    updated_at: nowIso
  };

  // Reconnecting reuses the existing row (by id) so historical energy_rows,
  // which are owned by connection_id, stay attached to the same connection
  // instead of being orphaned under a fresh id.
  const rows = existing
    ? await adminSupabaseRequest<ConnectionRow[]>(
        "PATCH",
        `/livemopay_connections?id=eq.${encodeURIComponent(existing.id)}`,
        payload,
        "return=representation"
      )
    : await adminSupabaseRequest<ConnectionRow[]>(
        "POST",
        "/livemopay_connections",
        [{ ...payload, connected_at: nowIso }],
        "return=representation"
      );

  return toConnection(rows[0]);
}

export async function finalizeLivemopayAccountSelection(userId: string, index: number): Promise<LivemopayConnection> {
  const row = await getConnectionRowForUser(userId);

  if (!row || row.status !== "pending_selection" || !row.pending_accounts) {
    throw new Error("No pending LiveMopay account selection for this user.");
  }

  const candidate = row.pending_accounts[index];
  if (!candidate) {
    throw new Error("Selected account is not one of the discovered candidates.");
  }

  // This is the "becomes connected" transition for the multi-candidate
  // flow -- same rule as beginLivemopayConnection's single-candidate path:
  // a fresh next_sync_at when auto-sync is (still) enabled.
  const nextSyncAt = row.auto_sync_enabled ? computeNextAutoSyncAt(row.id, new Date()).toISOString() : null;

  const rows = await adminSupabaseRequest<ConnectionRow[]>(
    "PATCH",
    `/livemopay_connections?id=eq.${encodeURIComponent(row.id)}`,
    {
      account_id: candidate.accountId,
      company_id: candidate.companyId,
      property_id: candidate.propertyId,
      account_label: candidate.label,
      status: "connected",
      pending_accounts: null,
      next_sync_at: nextSyncAt,
      updated_at: new Date().toISOString()
    },
    "return=representation"
  );

  return toConnection(rows[0]);
}

// Clears only the encrypted refresh token fields (nullable, enforced by the
// all-or-nothing check constraint) -- energy_rows/rollups/capture_runs stay
// exactly as they are, since they're owned by connection_id, not by the
// presence of a live token.
export async function disconnectLivemopayConnection(userId: string): Promise<void> {
  const row = await getConnectionRowForUser(userId);
  if (!row) {
    return;
  }

  if (row.is_demo) {
    throw new DemoAccountProtectedError("disconnecting");
  }

  await adminSupabaseRequest(
    "PATCH",
    `/livemopay_connections?id=eq.${encodeURIComponent(row.id)}`,
    {
      status: "disconnected",
      refresh_token_ciphertext: null,
      refresh_token_iv: null,
      refresh_token_auth_tag: null,
      pending_accounts: null,
      // auto_sync_enabled itself is left as-is (it's a user preference that
      // should survive a reconnect), but next_sync_at is cleared so a
      // disconnected connection is never "due" -- the claim RPC also filters
      // on status='connected' independently, so this is belt and braces for
      // the Settings UI reading a stale next-scheduled time more than it is
      // for claiming itself.
      next_sync_at: null,
      sync_claimed_at: null,
      updated_at: new Date().toISOString()
    },
    "return=minimal"
  );
}

// Full account wipe: deleting the connection row cascades to every table
// keyed off connection_id (energy_rows, capture_runs, all rollups,
// dashboard_summary -- see the ownership-columns migration), so nothing
// else needs to be deleted explicitly. Removing the auth user last means a
// failure there still leaves the user's data already gone rather than
// stranding an auth account with no way to reach it.
export async function deleteAccountForUser(userId: string): Promise<void> {
  const row = await getConnectionRowForUser(userId);
  if (row?.is_demo) {
    throw new DemoAccountProtectedError("account deletion");
  }

  await adminSupabaseRequest(
    "DELETE",
    `/livemopay_connections?user_id=eq.${encodeURIComponent(userId)}`,
    undefined,
    "return=minimal"
  );

  const admin = createSupabaseAdminClient();
  const { error } = await admin.auth.admin.deleteUser(userId);

  if (error) {
    throw new Error(error.message);
  }
}

export async function replaceConnectionRefreshToken(connectionId: string, refreshToken: string): Promise<void> {
  const encrypted = encryptRefreshToken(refreshToken);

  await adminSupabaseRequest(
    "PATCH",
    `/livemopay_connections?id=eq.${encodeURIComponent(connectionId)}`,
    {
      refresh_token_ciphertext: encrypted.ciphertext,
      refresh_token_iv: encrypted.iv,
      refresh_token_auth_tag: encrypted.authTag,
      updated_at: new Date().toISOString()
    },
    "return=minimal"
  );
}

export async function markConnectionSyncOutcome(connectionId: string, lastError: string | null): Promise<void> {
  await adminSupabaseRequest(
    "PATCH",
    `/livemopay_connections?id=eq.${encodeURIComponent(connectionId)}`,
    {
      last_synced_at: new Date().toISOString(),
      last_error: lastError,
      updated_at: new Date().toISOString(),
      // A successful sync means the data is fresh again -- reset the stale-push
      // dedupe flag here (the authoritative "went fresh" moment) so the next
      // time it goes stale the cron is free to notify once more. A failed sync
      // leaves the flag untouched: the data is still whatever it was.
      ...(lastError === null ? { stale_notified_at: null } : {})
    },
    "return=minimal"
  );
}

// Lightweight projection for the stale-check cron: just what the dedupe
// decision needs, for every currently-connected account. Deliberately omits
// the token/account columns -- the cron never touches LiveMopay, only decides
// whether to send a "your data looks stale" push. Demo connections are
// excluded (is_demo=eq.false) since their data is intentionally static and
// never syncs -- they would otherwise look permanently stale and get
// notified on every run.
export type StaleCheckConnection = {
  id: string;
  userId: string;
  lastSyncedAt: string | null;
  staleNotifiedAt: string | null;
};

export async function listConnectionsForStaleCheck(): Promise<StaleCheckConnection[]> {
  const rows = await adminSupabaseFetch<
    Array<Pick<ConnectionRow, "id" | "user_id" | "last_synced_at"> & { stale_notified_at: string | null }>
  >("/livemopay_connections?select=id,user_id,last_synced_at,stale_notified_at&status=eq.connected&is_demo=eq.false");

  return rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    lastSyncedAt: row.last_synced_at,
    staleNotifiedAt: row.stale_notified_at
  }));
}

// Records that a stale-data push has been sent for this connection's current
// stale episode, so subsequent cron runs skip it until a successful sync
// clears the flag (see markConnectionSyncOutcome).
export async function markConnectionStaleNotified(connectionId: string): Promise<void> {
  await adminSupabaseRequest(
    "PATCH",
    `/livemopay_connections?id=eq.${encodeURIComponent(connectionId)}`,
    { stale_notified_at: new Date().toISOString() },
    "return=minimal"
  );
}

// The stored refresh token is unrecoverable once it fails AES-GCM
// auth-tag verification (almost always a NEWINMETER_TOKEN_ENCRYPTION_KEY
// rotation orphaning it) -- retrying decryption can never succeed, so the
// connection is flipped out of "connected" (requireConnectedSession then
// naturally routes the user back through /connect) and the dead token
// fields are cleared rather than left around unusable.
export async function markConnectionAuthError(connectionId: string): Promise<void> {
  await adminSupabaseRequest(
    "PATCH",
    `/livemopay_connections?id=eq.${encodeURIComponent(connectionId)}`,
    {
      status: "error",
      last_error: "Stored refresh token could not be decrypted. Reconnect your LiveMopay account.",
      last_synced_at: new Date().toISOString(),
      refresh_token_ciphertext: null,
      refresh_token_iv: null,
      refresh_token_auth_tag: null,
      // status leaving 'connected' already excludes this row from
      // claim_due_auto_sync_connections(), but next_sync_at/sync_claimed_at
      // are cleared too so Settings/admin never show a stale "next sync"
      // time for a connection that needs reauth.
      next_sync_at: null,
      sync_claimed_at: null,
      last_auto_sync_status: "failed",
      last_auto_sync_error: "Reconnect required.",
      updated_at: new Date().toISOString()
    },
    "return=minimal"
  );
}

// ---------------------------------------------------------------------------
// Automatic sync scheduling
// ---------------------------------------------------------------------------

// Settings toggle. Ownership is resolved from the authenticated session's
// userId (the caller), never a connection id supplied by the browser -- see
// /api/livemopay/auto-sync. Turning automatic updates on assigns a fresh
// next_sync_at when the connection is actually connected (there's nothing
// to schedule otherwise -- the claim RPC would exclude it anyway, but a
// non-null next_sync_at while disconnected would be a misleading thing for
// Settings to display). Turning them off clears next_sync_at, which is what
// actually stops future claims (independent of, and in addition to, the
// claim RPC's own auto_sync_enabled check).
export async function setAutoSyncEnabled(userId: string, enabled: boolean): Promise<LivemopayConnection> {
  const row = await getConnectionRowForUser(userId);
  if (!row) {
    throw new Error("No LiveMopay connection for this user.");
  }
  if (row.is_demo) {
    throw new DemoAccountProtectedError("automatic sync");
  }

  const nextSyncAt = enabled && row.status === "connected" ? computeNextAutoSyncAt(row.id, new Date()).toISOString() : null;

  const rows = await adminSupabaseRequest<ConnectionRow[]>(
    "PATCH",
    `/livemopay_connections?id=eq.${encodeURIComponent(row.id)}`,
    {
      auto_sync_enabled: enabled,
      next_sync_at: nextSyncAt,
      updated_at: new Date().toISOString()
    },
    "return=representation"
  );

  return toConnection(rows[0]);
}

// Minimal scaffolding toggle for the future alert system -- see the
// alerts_enabled column comment in the auto-sync-schedule migration. No
// alert evaluation exists yet; this only persists the preference.
export async function setAlertsEnabled(userId: string, enabled: boolean): Promise<LivemopayConnection> {
  const row = await getConnectionRowForUser(userId);
  if (!row) {
    throw new Error("No LiveMopay connection for this user.");
  }
  if (row.is_demo) {
    throw new DemoAccountProtectedError("alerts");
  }

  const rows = await adminSupabaseRequest<ConnectionRow[]>(
    "PATCH",
    `/livemopay_connections?id=eq.${encodeURIComponent(row.id)}`,
    { alerts_enabled: enabled, updated_at: new Date().toISOString() },
    "return=representation"
  );

  return toConnection(rows[0]);
}

// What the auto-sync worker needs to actually run a sync for one claimed
// connection -- deliberately narrow (no email, no account_label, no
// pending_accounts) since this crosses from trusted server-to-server RPC
// output straight into runLivemopaySync() territory.
export type ClaimedAutoSyncConnection = {
  id: string;
  userId: string;
  accountId: string;
  companyId: string;
  propertyId: string;
  refreshTokenCiphertext: string;
  refreshTokenIv: string;
  refreshTokenAuthTag: string;
};

type ClaimRpcRow = {
  id: string;
  user_id: string;
  account_id: string;
  company_id: string;
  property_id: string;
  refresh_token_ciphertext: string;
  refresh_token_iv: string;
  refresh_token_auth_tag: string;
};

// Atomically claims up to `limit` due connections via the
// claim_due_auto_sync_connections RPC (see the auto-sync-schedule
// migration) -- the scheduler-claim layer that sits above
// capture_runs_one_running_per_connection, preventing two overlapping
// worker invocations from both dispatching the same connection. Demo
// connections are excluded inside the RPC itself, not here.
export async function claimDueAutoSyncConnections(
  limit: number,
  claimTtlMinutes: number
): Promise<ClaimedAutoSyncConnection[]> {
  const rows = await adminSupabaseRequest<ClaimRpcRow[]>("POST", "/rpc/claim_due_auto_sync_connections", {
    p_limit: limit,
    p_claim_ttl: `${claimTtlMinutes} minutes`
  });

  return rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    accountId: row.account_id,
    companyId: row.company_id,
    propertyId: row.property_id,
    refreshTokenCiphertext: row.refresh_token_ciphertext,
    refreshTokenIv: row.refresh_token_iv,
    refreshTokenAuthTag: row.refresh_token_auth_tag
  }));
}

// Successful automatic sync: preserves the general last_synced_at/last_error
// state (same fields a manual sync updates, and same stale_notified_at
// reset -- see markConnectionSyncOutcome), sets the automatic-specific
// success state, clears any stale automatic error, releases the scheduler
// claim, and computes the next deterministic scheduled window.
export async function markAutoSyncSuccess(connectionId: string): Promise<void> {
  const nowIso = new Date().toISOString();
  const nextSyncAt = computeNextAutoSyncAt(connectionId, new Date()).toISOString();

  await adminSupabaseRequest(
    "PATCH",
    `/livemopay_connections?id=eq.${encodeURIComponent(connectionId)}`,
    {
      last_synced_at: nowIso,
      last_error: null,
      stale_notified_at: null,
      last_auto_sync_at: nowIso,
      last_auto_sync_status: "success",
      last_auto_sync_error: null,
      sync_claimed_at: null,
      next_sync_at: nextSyncAt,
      updated_at: nowIso
    },
    "return=minimal"
  );
}

// Retryable automatic-sync failure (network error, upstream 5xx, timeout --
// anything that isn't a permanent auth failure, which goes through
// markConnectionAuthError instead and leaves the connection out of
// 'connected' status entirely). Releases the claim and schedules a modest
// flat-backoff retry rather than hammering LiveMopay again on the very next
// 5-minute scheduler tick.
export async function markAutoSyncFailure(connectionId: string, message: string): Promise<void> {
  const nowIso = new Date().toISOString();
  const nextSyncAt = computeAutoSyncRetryAt(new Date()).toISOString();

  await adminSupabaseRequest(
    "PATCH",
    `/livemopay_connections?id=eq.${encodeURIComponent(connectionId)}`,
    {
      last_error: message,
      last_auto_sync_at: nowIso,
      last_auto_sync_status: "failed",
      last_auto_sync_error: message,
      sync_claimed_at: null,
      next_sync_at: nextSyncAt,
      updated_at: nowIso
    },
    "return=minimal"
  );
}

// Releases a scheduler claim without recording any success/failure state --
// used only when runLivemopaySync() threw SyncAlreadyRunningError, i.e. a
// manual refresh (or another automatic attempt) already holds the real
// capture_runs lock. That's not this connection's fault, so next_sync_at is
// left exactly as it was (still due) and the next scheduler tick -- or the
// in-flight sync finishing -- resolves it naturally rather than recording a
// spurious failure.
export async function releaseAutoSyncClaim(connectionId: string): Promise<void> {
  await adminSupabaseRequest(
    "PATCH",
    `/livemopay_connections?id=eq.${encodeURIComponent(connectionId)}`,
    { sync_claimed_at: null, updated_at: new Date().toISOString() },
    "return=minimal"
  );
}
