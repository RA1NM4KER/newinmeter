import "server-only";

import { cache } from "react";
import { adminSupabaseFetch, adminSupabaseRequest } from "./supabase-rest";
import { createSupabaseAdminClient } from "./supabase/admin-client";
import { getFeatureAccessForUsers, type FeatureAccessDetail } from "./features";
import type { FeatureKey } from "./newinmeter/features-shared";

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
// independently -- without it, one navigation reads (or worse, tries to
// provision) the same user's role row 2+ times.
export const getOrCreateUserPermissions = cache(async (userId: string): Promise<UserPermissions> => {
  const rows = await adminSupabaseFetch<UserRoleRow[]>(
    `/user_roles?select=${SELECT}&user_id=eq.${encodeURIComponent(userId)}&limit=1`
  );

  if (rows[0]) {
    return toPermissions(rows[0]);
  }

  const created = await adminSupabaseRequest<UserRoleRow[]>(
    "POST",
    "/user_roles",
    [{ user_id: userId }],
    "return=representation"
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
  auto_sync_enabled: boolean;
  next_sync_at: string | null;
  last_auto_sync_status: "success" | "failed" | null;
  last_auto_sync_at: string | null;
};

type CaptureRunRow = {
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

// user list (for email), since auth.users isn't exposed over PostgREST.
// Anyone who has never triggered getOrCreateUserPermissions (signed in but
// never loaded a page that resolves it) still gets a synthesized 'user' row
// here so they aren't invisible to the admin.
export async function listAllUserPermissions(): Promise<AdminUserListItem[]> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000 });

  if (error) {
    throw new Error(error.message);
  }

  const roleRows = await adminSupabaseFetch<UserRoleRow[]>(`/user_roles?select=${SELECT}`);
  const roleByUserId = new Map(roleRows.map((row) => [row.user_id, toPermissions(row)]));

  // A user can have more than one connection row over time (e.g. an old
  // 'error'/'disconnected' row plus a later reconnect) -- ordering by
  // updated_at desc and keeping the first hit per user_id gives the current
  // one.
  const connectionRows = await adminSupabaseFetch<ConnectionRow[]>(
    "/livemopay_connections?select=id,user_id,status,updated_at,auto_sync_enabled,next_sync_at," +
      "last_auto_sync_status,last_auto_sync_at&order=updated_at.desc"
  );
  const connectionStatusByUserId = new Map<string, LivemopayConnectionStatus>();
  const autoSyncByUserId = new Map<string, Pick<ConnectionRow, "auto_sync_enabled" | "next_sync_at" | "last_auto_sync_status" | "last_auto_sync_at">>();
  const userIdByConnectionId = new Map<string, string>();
  for (const row of connectionRows) {
    if (!connectionStatusByUserId.has(row.user_id)) {
      connectionStatusByUserId.set(row.user_id, row.status);
      autoSyncByUserId.set(row.user_id, row);
    }
    userIdByConnectionId.set(row.id, row.user_id);
  }

  // Same latest-row-wins approach for sync history: a connection accrues one
  // capture_runs row per sync attempt, so this is "what happened last time
  // we tried to pull this user's data" -- the thing that actually tells you
  // who's stuck vs. who's syncing fine.
  const captureRunRows = await adminSupabaseFetch<CaptureRunRow[]>(
    "/capture_runs?select=connection_id,status,started_at,finished_at,rows_synced,error&order=started_at.desc"
  );
  const lastRunByUserId = new Map<string, CaptureRunRow>();
  for (const row of captureRunRows) {
    if (!row.connection_id) {
      continue;
    }
    const userId = userIdByConnectionId.get(row.connection_id);
    if (userId && !lastRunByUserId.has(userId)) {
      lastRunByUserId.set(userId, row);
    }
  }

  const featureAccessByUserId = await getFeatureAccessForUsers(data.users.map((user) => user.id));

  return data.users
    .map((user) => {
      const permissions = roleByUserId.get(user.id);
      const lastRun = lastRunByUserId.get(user.id);

      return {
        userId: user.id,
        email: user.email ?? null,
        createdAt: user.created_at,
        role: permissions?.role ?? "user",
        features: featureAccessByUserId.get(user.id)!,
        connectionStatus: connectionStatusByUserId.get(user.id) ?? null,
        lastRunStatus: lastRun?.status ?? null,
        lastRunAt: lastRun?.finished_at ?? lastRun?.started_at ?? null,
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

