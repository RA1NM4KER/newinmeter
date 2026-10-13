import "server-only";

import { cache } from "react";
import { adminSupabaseFetch, adminSupabaseRequest } from "./supabase-rest";
import { createSupabaseAdminClient } from "./supabase/admin-client";
import { getFeatureAccessForUsers, type FeatureAccessDetail } from "./features";
import type { FeatureKey } from "./newinmeter/features-shared";

import { connectionLifecycle, type ConnectionLifecycle } from "./connection-lifecycle";
import type { ConnectionDataState } from "./newinmeter/connection";

export type UserRole = "admin" | "user";

export type UserPermissions = {
  userId: string;
  role: UserRole;
};

type UserRoleRow = {
  user_id: string;
  role: UserRole;
};

const SELECT = "user_id,role";

function toPermissions(row: UserRoleRow): UserPermissions {
  return {
    userId: row.user_id,
    role: row.role
  };
}

// Lazily provisions a role row on first authenticated access, so every
// signed-in user has one without needing a signup-time hook. Defaults to
// 'user' -- the one seed admin is created by migration instead.
// cache()'d because the layout and every page under it each call this
// independently within one request -- without it, one navigation reads (or
// worse, tries to provision) the same user's role row 2+ times.
//
// cache() only dedupes calls within a single request, not across two
// genuinely concurrent requests (two tabs, a double-tap, a slow first load
// racing a retry), so the fallback write below is an upsert
// (on_conflict=user_id, resolution=merge-duplicates), not a plain insert.
// A plain POST here previously caused a real production crash: two
// concurrent requests for a brand-new user both passed the select-empty
// check, then raced to insert the same user_id, and the loser hit a
// user_roles_pkey unique violation that surfaced as an unhandled 500 on the
// homepage. The upsert makes both requests succeed and return the same row
// no matter which one "wins."
export const getOrCreateUserPermissions = cache(async (userId: string): Promise<UserPermissions> => {
  const rows = await adminSupabaseFetch<UserRoleRow[]>(
    `/user_roles?select=${SELECT}&user_id=eq.${encodeURIComponent(userId)}&limit=1`
  );

  if (rows[0]) {
    return toPermissions(rows[0]);
  }

  const created = await adminSupabaseRequest<UserRoleRow[]>(
    "POST",
    "/user_roles?on_conflict=user_id",
    [{ user_id: userId }],
    "resolution=merge-duplicates,return=representation"
  );

  return toPermissions(created[0]);
});

export type LivemopayConnectionStatus = "connected" | "pending_selection" | "disconnected" | "error";

export type CaptureRunStatus = "running" | "success" | "failed";

export type AdminUserListItem = UserPermissions & {
  email: string | null;
  createdAt: string;
  features: Record<FeatureKey, FeatureAccessDetail>;
  connectionStatus: LivemopayConnectionStatus | null;
  connectionLifecycle: ConnectionLifecycle | null;
  lastRunStatus: CaptureRunStatus | null;
  lastRunAt: string | null;
  lastRunError: string | null;
  lastRunRowsSynced: number | null;
  autoSyncEnabled: boolean | null;
  nextSyncAt: string | null;
  lastAutoSyncStatus: "success" | "failed" | null;
  lastAutoSyncAt: string | null;
};

type ConnectionRow = {
  id: string;
  user_id: string;
  status: LivemopayConnectionStatus;
  updated_at: string;
  data_state: ConnectionDataState;
  last_synced_at: string | null;
  auto_sync_enabled: boolean;
  next_sync_at: string | null;
  last_auto_sync_status: "success" | "failed" | null;
  last_auto_sync_at: string | null;
  capture_runs: CaptureRunRow[];
};

type CaptureRunRow = {
  id: string;
  connection_id: string | null;
  status: CaptureRunStatus;
  started_at: string;
  finished_at: string | null;
  rows_synced: number | null;
  error: string | null;
};

// Admin's user list: role/permission rows joined against Supabase Auth's
// Every NewinMeter user's id + email, resolved from Supabase Auth (not
// exposed over PostgREST). Shared by anything that needs to enumerate users
// without the rest of listAllUserPermissions's connection/sync joins -- the
// Features tab's rollout counts and per-feature override lists, in
// particular.
export async function listAllAuthUsers(): Promise<Array<{ userId: string; email: string | null }>> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000 });

  if (error) {
    throw new Error(error.message);
  }

  return data.users.map((user) => ({ userId: user.id, email: user.email ?? null }));
}

export async function listAdminUserIds(): Promise<string[]> {
  const rows = await adminSupabaseFetch<UserRoleRow[]>("/user_roles?select=user_id,role&role=eq.admin");
  return rows.map((row) => row.user_id);
}

// user list (for email), since auth.users isn't exposed over PostgREST.
// Anyone who has never triggered getOrCreateUserPermissions (signed in but
// never loaded a page that resolves it) still gets a synthesized 'user' row
// here so they aren't invisible to the admin.
export async function listAllUserPermissions(): Promise<AdminUserListItem[]> {
  const admin = createSupabaseAdminClient();
  const usersPromise = admin.auth.admin.listUsers({ perPage: 1000 }).then(({ data, error }) => {
    if (error) throw new Error(error.message);
    return data;
  });
  // Independent reads overlap; feature access depends only on Auth user IDs.
  // The embedded limit applies per connection, using the existing history index.
  const [data, roleRows, connectionRows, pausedRows, featureAccessByUserId] = await Promise.all([
    usersPromise,
    adminSupabaseFetch<UserRoleRow[]>(`/user_roles?select=${SELECT}`),
    adminSupabaseFetch<ConnectionRow[]>(
      "/livemopay_connections?select=id,user_id,status,updated_at,data_state,last_synced_at,auto_sync_enabled,next_sync_at," +
        "last_auto_sync_status,last_auto_sync_at,capture_runs(id,connection_id,status,started_at,finished_at,rows_synced,error)" +
        "&capture_runs.order=started_at.desc,id.desc&capture_runs.limit=1&order=updated_at.desc,id.desc"
    ),
    adminSupabaseRequest<{ connection_id: string }[]>("POST", "/rpc/auto_sync_paused_connection_ids", {}),
    usersPromise.then(({ users }) => getFeatureAccessForUsers(users.map((user) => user.id)))
  ]);
  const roleByUserId = new Map(roleRows.map((row) => [row.user_id, toPermissions(row)]));
  const pausedIds = new Set(pausedRows.map((row) => row.connection_id));
  const currentConnectionByUserId = new Map<string, ConnectionRow>();
  const connectionStatusByUserId = new Map<string, LivemopayConnectionStatus>();
  const autoSyncByUserId = new Map<
    string,
    Pick<ConnectionRow, "auto_sync_enabled" | "next_sync_at" | "last_auto_sync_status" | "last_auto_sync_at">
  >();
  const lastRunByUserId = new Map<string, CaptureRunRow>();
  for (const row of connectionRows) {
    if (!connectionStatusByUserId.has(row.user_id)) {
      currentConnectionByUserId.set(row.user_id, row);
      connectionStatusByUserId.set(row.user_id, row.status);
      autoSyncByUserId.set(row.user_id, row);
    }
    // Preserve the latest attempt across reconnects, not just the current connection.
    const run = row.capture_runs[0];
    const previous = lastRunByUserId.get(row.user_id);
    if (
      run &&
      (!previous ||
        Date.parse(run.started_at) > Date.parse(previous.started_at) ||
        (Date.parse(run.started_at) === Date.parse(previous.started_at) && run.id > previous.id))
    ) {
      lastRunByUserId.set(row.user_id, run);
    }
  }

  return data.users
    .map((user) => {
      const permissions = roleByUserId.get(user.id);
      const lastRun = lastRunByUserId.get(user.id);
      const connection = currentConnectionByUserId.get(user.id);
      // Successful sync metadata survives ledger purging and missing capture history.
      // Do not use connection update/cold timestamps as invented sync timestamps.
      const retainedSuccessAt = connection?.last_synced_at ?? null;

      return {
        userId: user.id,
        email: user.email ?? null,
        createdAt: user.created_at,
        role: permissions?.role ?? "user",
        features: featureAccessByUserId.get(user.id)!,
        connectionStatus: connectionStatusByUserId.get(user.id) ?? null,
        connectionLifecycle: connection
          ? connectionLifecycle(connection.data_state, pausedIds.has(connection.id))
          : null,
        lastRunStatus: lastRun?.status ?? (retainedSuccessAt ? "success" : null),
        lastRunAt: lastRun?.finished_at ?? lastRun?.started_at ?? retainedSuccessAt,
        lastRunError: lastRun?.error ?? null,
        lastRunRowsSynced: lastRun?.rows_synced ?? null,
        autoSyncEnabled: autoSyncByUserId.get(user.id)?.auto_sync_enabled ?? null,
        nextSyncAt: autoSyncByUserId.get(user.id)?.next_sync_at ?? null,
        lastAutoSyncStatus: autoSyncByUserId.get(user.id)?.last_auto_sync_status ?? null,
        lastAutoSyncAt: autoSyncByUserId.get(user.id)?.last_auto_sync_at ?? null
      };
    })
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function setUserRole(userId: string, role: UserRole): Promise<void> {
  await getOrCreateUserPermissions(userId);

  await adminSupabaseRequest(
    "PATCH",
    `/user_roles?user_id=eq.${encodeURIComponent(userId)}`,
    { role, updated_at: new Date().toISOString() },
    "return=minimal"
  );
}
