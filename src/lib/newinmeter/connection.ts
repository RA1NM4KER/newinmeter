import "server-only";

import { cache } from "react";
import { adminSupabaseFetch, adminSupabaseRequest } from "../supabase-rest";
import { createSupabaseAdminClient } from "../supabase/admin-client";
import { decryptRefreshToken, encryptRefreshToken } from "../token-encryption";
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
};

const CONNECTION_SELECT =
  "id,user_id,livemopay_email,firebase_local_id,account_id,company_id,property_id,account_label," +
  "refresh_token_ciphertext,refresh_token_iv,refresh_token_auth_tag,pending_accounts,status," +
  "connected_at,updated_at,last_synced_at,last_error,is_demo";

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
    isDemo: row.is_demo
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

  const payload = {
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
      updated_at: new Date().toISOString()
    },
    "return=minimal"
  );
}
