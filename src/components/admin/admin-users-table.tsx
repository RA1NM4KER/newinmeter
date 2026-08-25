"use client";

import { Pencil, RefreshCw } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type ColumnDef, flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { DropdownSelect } from "@/components/ui/dropdown-select";
import { ScrollHint } from "@/components/ui/scroll-hint";
import { SortHeaderButton } from "@/components/ui/sort-header-button";
import { apiEndpoints, buildAdminUserPermissionsUrl, buildAdminUserRoleUrl } from "@/lib/endpoints";
import type { AdminUsersSortKey } from "@/lib/admin-users-query-params";
import type { FeatureKey } from "@/lib/newinmeter/features-shared";
import { useAdminUsersUrlState } from "@/lib/url-state/use-admin-users-url-state";
import type { AdminUserListItem, UserRole } from "@/lib/user-roles";
import { adminUsersColumns } from "./admin-users-columns";
import { ConnectionStatusBadge } from "./connection-status-badge";
import { FeatureChips } from "./feature-chips";
import { LastSyncCell } from "./last-sync-cell";
import { ManageDrawer } from "./manage-drawer";
import { StatStripSkeleton, StatTile } from "./stat-tile";
import { TableSkeletonRows } from "./table-skeleton-rows";
import type { AdminUsersApiResponse, AdminUsersTableProps, FeatureDraft } from "./types";

const ACTIVE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

const roleOptions = [
  { label: "Admin", value: "admin" },
  { label: "User", value: "user" }
];

async function fetchAdminUsers() {
  const response = await fetch(apiEndpoints.adminUsers, { cache: "no-store" });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || "Failed to load users.");
  }

  return (await response.json()) as AdminUsersApiResponse;
}

export function AdminUsersTable({ currentUserId, initialData }: AdminUsersTableProps) {
  const { sortKey, sortDirection, onSortChange } = useAdminUsersUrlState();
  const [pendingUserId, setPendingUserId] = useState<string | null>(null);
  const [errorByUserId, setErrorByUserId] = useState<Record<string, string>>({});
  const [isManualRefreshing, setIsManualRefreshing] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [drawerSaving, setDrawerSaving] = useState(false);
  const [drawerError, setDrawerError] = useState("");
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  const queryKey = ["admin-users"];
  const { data, isFetching, isLoading, error, refetch } = useQuery({
    queryKey,
    queryFn: fetchAdminUsers,
    initialData
  });

  // Client-side sort by the selected column. Server returns oldest-joined-first.
  const users = useMemo(() => {
    const rows = [...(data?.rows ?? [])];
    const dir = sortDirection === "asc" ? 1 : -1;

    if (sortKey === "lastSync") {
      // Users who have never synced sort to the bottom regardless of direction.
      return rows.sort((a, b) => {
        const ta = a.lastRunAt ? Date.parse(a.lastRunAt) : null;
        const tb = b.lastRunAt ? Date.parse(b.lastRunAt) : null;
        if (ta === null && tb === null) return 0;
        if (ta === null) return 1;
        if (tb === null) return -1;
        return (ta - tb) * dir;
      });
    }

    return rows.sort((a, b) => (Date.parse(a.createdAt) - Date.parse(b.createdAt)) * dir);
  }, [data?.rows, sortKey, sortDirection]);
  const total = data?.total ?? 0;
  const showTableSkeleton = isLoading || isManualRefreshing;
  const selectedUser = selectedUserId ? (users.find((user) => user.userId === selectedUserId) ?? null) : null;

  const stats = useMemo(() => {
    const rows = data?.rows ?? [];
    const now = Date.now();

    return {
      connected: rows.filter((user) => user.connectionStatus === "connected").length,
      needsHelp: rows.filter((user) => user.lastRunStatus === "failed").length,
      active: rows.filter(
        (user) =>
          user.lastRunStatus === "success" &&
          user.lastRunAt &&
          now - new Date(user.lastRunAt).getTime() < ACTIVE_WINDOW_MS
      ).length
    };
  }, [data?.rows]);

  function patchLocalUser(userId: string, patch: Partial<AdminUserListItem>) {
    queryClient.setQueryData<AdminUsersApiResponse | undefined>(queryKey, (current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        rows: current.rows.map((user) => (user.userId === userId ? { ...user, ...patch } : user))
      };
    });
  }

  const handleRefresh = async () => {
    setIsManualRefreshing(true);

    try {
      await refetch();
    } finally {
      setIsManualRefreshing(false);
    }
  };

  function openDrawer(userId: string) {
    setDrawerError("");
    setSelectedUserId(userId);
  }

  function closeDrawer() {
    if (drawerSaving) {
      return;
    }
    setSelectedUserId(null);
    setDrawerError("");
  }

  async function handleRoleChange(userId: string, role: UserRole) {
    const previous = users.find((user) => user.userId === userId)?.role ?? "user";
    setErrorByUserId((current) => ({ ...current, [userId]: "" }));
    patchLocalUser(userId, { role });
    setPendingUserId(userId);

    try {
      const response = await fetch(buildAdminUserRoleUrl(userId), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role })
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.message || "Couldn't update role.");
      }
    } catch (caught) {
      patchLocalUser(userId, { role: previous });
      setErrorByUserId((current) => ({
        ...current,
        [userId]: caught instanceof Error ? caught.message : "Couldn't update role."
      }));
    } finally {
      setPendingUserId(null);
    }
  }

  // Every change here becomes an explicit per-user override -- optimistic
  // patch marks the source as "override" immediately (matches what the
  // write actually does), reverted to the pre-save detail (value + source)
  // on failure.
  function patchLocalUserFeatures(userId: string, changes: Partial<FeatureDraft>) {
    queryClient.setQueryData<AdminUsersApiResponse | undefined>(queryKey, (current) => {
      if (!current) {
        return current;
      }
      return {
        ...current,
        rows: current.rows.map((user) => {
          if (user.userId !== userId) {
            return user;
          }
          const features = { ...user.features };
          for (const key of Object.keys(changes) as FeatureKey[]) {
            features[key] = { enabled: changes[key]!, source: "override" };
          }
          return { ...user, features };
        })
      };
    });
  }

  async function handleSaveFeatures(userId: string, changes: Partial<FeatureDraft>): Promise<boolean> {
    if (Object.keys(changes).length === 0) {
      return true; // nothing changed; let the drawer animate closed
    }

    const target = users.find((user) => user.userId === userId);
    if (!target) {
      return false;
    }
    const previous: Partial<AdminUserListItem["features"]> = {};
    for (const key of Object.keys(changes) as FeatureKey[]) {
      previous[key] = target.features[key];
    }

    setDrawerError("");
    setDrawerSaving(true);
    patchLocalUserFeatures(userId, changes);

    try {
      const response = await fetch(buildAdminUserPermissionsUrl(userId), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(changes)
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.message || "Couldn't update features.");
      }

      setDrawerSaving(false);
      return true;
    } catch (caught) {
      patchLocalUser(userId, { features: { ...target.features, ...previous } });
      setDrawerSaving(false);
      setDrawerError(caught instanceof Error ? caught.message : "Couldn't update features.");
      return false;
    }
  }

  const columns: ColumnDef<AdminUserListItem>[] = adminUsersColumns.map((column) => ({
    id: column.id,
    header: column.label,
    enableSorting: column.sortable,
    cell: ({ row }) => {
      const user = row.original;

      switch (column.id) {
        case "user": {
          const isSelf = user.userId === currentUserId;
          const rowError = errorByUserId[user.userId];
          return (
            <>
              <p className="text-ink">{user.email ?? "Unknown"}</p>
              {isSelf ? <p className="text-xs text-muted">This is you</p> : null}
              {rowError ? <p className="text-xs text-red-600">{rowError}</p> : null}
            </>
          );
        }
        case "joined":
          return <span className="text-muted">{new Date(user.createdAt).toLocaleDateString()}</span>;
        case "role": {
          const isSelf = user.userId === currentUserId;
          const isUserPending = pendingUserId === user.userId;
          return (
            <DropdownSelect
              ariaLabel={`Role for ${user.email ?? user.userId}`}
              value={user.role}
              options={
                isSelf
                  ? roleOptions.map((option) => (option.value === "user" ? { ...option, disabled: true } : option))
                  : roleOptions
              }
              onChange={(value) => void handleRoleChange(user.userId, value as UserRole)}
              loading={isUserPending}
              className="w-28"
            />
          );
        }
        case "features":
          return (
            <div className="flex items-center gap-2">
              <FeatureChips user={user} />
              <button
                type="button"
                aria-label={`Manage features for ${user.email ?? user.userId}`}
                onClick={(event) => {
                  event.stopPropagation();
                  openDrawer(user.userId);
                }}
                className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted/50 opacity-0 outline-none transition hover:text-ink group-hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-line"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        case "livemopay":
          return <ConnectionStatusBadge status={user.connectionStatus} />;
        case "lastSync":
          return <LastSyncCell user={user} />;
      }
    }
  }));

  const table = useReactTable({
    data: users,
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualSorting: true,
    state: {
      sorting: [{ id: sortKey, desc: sortDirection === "desc" }]
    }
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      {showTableSkeleton ? (
        <StatStripSkeleton />
      ) : (
        <div className="grid grid-cols-4 gap-2 sm:gap-3">
          <StatTile
            label={
              <>
                <span className="sm:hidden">Users</span>
                <span className="hidden sm:inline">Total users</span>
              </>
            }
            value={total}
          />
          <StatTile label="Connected" value={stats.connected} />
          <StatTile
            label={
              <>
                <span className="sm:hidden">Active</span>
                <span className="hidden sm:inline">Active (7d)</span>
              </>
            }
            value={stats.active}
          />
          <StatTile
            label={
              <>
                <span className="sm:hidden">Help</span>
                <span className="hidden sm:inline">Needs help</span>
              </>
            }
            tone="warning"
            value={stats.needsHelp}
          />
        </div>
      )}

      {/* Match Data and Activities Table: edge-to-edge, borderless surface
          below lg; normal floating card on desktop. */}
      <section className="-mx-3 flex h-0 min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-line bg-paper sm:-mx-6 lg:mx-0 lg:rounded-lg lg:border">
        <div className="relative min-h-0 flex-1">
          <div className="h-full overflow-auto" ref={tableScrollRef}>
            <table className="w-full min-w-[760px] border-separate border-spacing-0 text-left text-sm">
              <thead className="sticky top-0 z-10 border-b border-line bg-accentSoft text-xs uppercase tracking-[0.16em] text-brandTeal dark:text-accent shadow-[0_1px_0_rgb(var(--color-line))]">
                <tr>
                  {adminUsersColumns.map((column) => (
                    <th className="px-4 py-3 font-medium" key={column.id}>
                      {column.sortable ? (
                        <SortHeaderButton
                          label={column.label}
                          shortLabel={column.shortLabel}
                          active={sortKey === column.id}
                          direction={sortDirection}
                          onClick={() => onSortChange(column.id as AdminUsersSortKey)}
                        />
                      ) : (
                        column.label
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {showTableSkeleton ? (
                  <TableSkeletonRows rowCount={8} />
                ) : (
                  table.getRowModel().rows.map((row) => {
                    const user = row.original;
                    const isActive = user.userId === selectedUserId;

                    return (
                      <tr
                        key={user.userId}
                        onClick={() => openDrawer(user.userId)}
                        className={`group cursor-pointer transition hover:bg-canvas/70 ${isActive ? "bg-accentSoft/50" : ""}`}
                      >
                        {row.getVisibleCells().map((cell) => (
                          <td
                            className="px-4 py-3"
                            key={cell.id}
                            onClick={cell.column.id === "role" ? (event) => event.stopPropagation() : undefined}
                          >
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </td>
                        ))}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          <ScrollHint containerRef={tableScrollRef} />
        </div>

        <div className="flex h-11 shrink-0 items-center justify-between gap-3 border-t border-line px-3">
          <p className="text-sm text-muted">
            {!isLoading ? `${total} users` : "Loading users..."}
            {isFetching && !isLoading ? " · updating..." : ""}
          </p>
          <button
            aria-label="Refresh users"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-sm text-muted transition enabled:hover:text-ink disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isManualRefreshing}
            onClick={() => {
              void handleRefresh();
            }}
            type="button"
            title="Refresh users"
          >
            <RefreshCw aria-hidden="true" className={`h-4 w-4 ${isManualRefreshing ? "animate-spin" : ""}`} />
          </button>
        </div>

        {error instanceof Error ? <p className="px-3 py-2 text-sm text-red-500">{error.message}</p> : null}
      </section>

      {selectedUser ? (
        <ManageDrawer
          key={selectedUser.userId}
          user={selectedUser}
          isSelf={selectedUser.userId === currentUserId}
          saving={drawerSaving}
          error={drawerError}
          onClose={closeDrawer}
          onSave={(changes) => handleSaveFeatures(selectedUser.userId, changes)}
        />
      ) : null}
    </div>
  );
}
