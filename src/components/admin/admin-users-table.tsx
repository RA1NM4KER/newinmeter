"use client";

import { ArrowDown, ArrowUp, ArrowUpDown, Check, Copy, Pencil, RefreshCw, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { DropdownSelect } from "@/components/ui/dropdown-select";
import { ScrollHint } from "@/components/ui/scroll-hint";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { apiEndpoints } from "@/lib/endpoints";
import { useAdminUsersUrlState } from "@/lib/use-admin-users-url-state";
import type { AdminUserListItem, CaptureRunStatus, LivemopayConnectionStatus, UserRole } from "@/lib/user-roles";

const ACTIVE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

type AdminUsersTableProps = {
  currentUserId: string;
  initialData: AdminUsersApiResponse;
};

type AdminUsersApiResponse = {
  rows: AdminUserListItem[];
  total: number;
};

// The three per-user feature flags, described once so the chips and the drawer
// stay in sync. `key` matches both the AdminUserListItem field and the
// permissions API body field.
const FEATURES = [
  {
    key: "aiAssistantEnabled",
    short: "AI",
    name: "AI Assistant",
    description: "Access to the account-aware NewinMeter assistant."
  },
  {
    key: "activitiesEnabled",
    short: "Activities",
    name: "Activities",
    description: "Daily notes, tags and activity reporting."
  },
  {
    key: "liveMeterEnabled",
    short: "Live",
    name: "Live Meter",
    description: "Experimental optical meter telemetry and live usage view."
  }
] as const;

type FeatureKey = (typeof FEATURES)[number]["key"];

const roleOptions = [
  { label: "Admin", value: "admin" },
  { label: "User", value: "user" }
];

const connectionStatusLabel: Record<LivemopayConnectionStatus, string> = {
  connected: "Connected",
  pending_selection: "Choosing account",
  disconnected: "Disconnected",
  error: "Error"
};

const connectionStatusDotClass: Record<LivemopayConnectionStatus, string> = {
  connected: "bg-accent",
  pending_selection: "bg-amber-500",
  disconnected: "bg-muted",
  error: "bg-red-500"
};

function formatRelativeTime(isoDate: string): string {
  const diffMs = Date.now() - new Date(isoDate).getTime();
  const diffMinutes = Math.round(diffMs / 60_000);

  if (diffMinutes < 1) return "just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.round(diffHours / 24);
  if (diffDays < 30) return `${diffDays}d ago`;

  const diffMonths = Math.round(diffDays / 30);
  return `${diffMonths}mo ago`;
}

const lastRunLabel: Record<CaptureRunStatus, string> = {
  success: "Synced",
  failed: "Failed",
  running: "Syncing"
};

const lastRunDotClass: Record<CaptureRunStatus, string> = {
  success: "bg-accent",
  failed: "bg-red-500",
  running: "bg-amber-500"
};

function LastSyncCell({ user }: { user: AdminUserListItem }) {
  if (!user.lastRunStatus || !user.lastRunAt) {
    return <span className="text-xs text-muted">No sync yet</span>;
  }

  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs text-ink"
      title={user.lastRunStatus === "failed" ? (user.lastRunError ?? "Sync failed") : undefined}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${lastRunDotClass[user.lastRunStatus]}`} aria-hidden="true" />
      {lastRunLabel[user.lastRunStatus]} · {formatRelativeTime(user.lastRunAt)}
    </span>
  );
}

type StatTileProps = { label: string; value: number; tone?: "default" | "warning" };

function StatTile({ label, value, tone = "default" }: StatTileProps) {
  return (
    <Card className="flex-1 px-2 py-2 sm:px-4 sm:py-3">
      <p className="truncate text-[0.6rem] uppercase tracking-[0.1em] text-muted sm:text-xs sm:tracking-[0.12em]">
        {label}
      </p>
      <p
        className={`mt-1 text-lg font-semibold tabular-nums sm:text-2xl ${tone === "warning" && value > 0 ? "text-red-500" : "text-ink"}`}
      >
        {value}
      </p>
    </Card>
  );
}

function StatStripSkeleton() {
  return (
    <div className="grid grid-cols-4 gap-2 sm:gap-3">
      {Array.from({ length: 4 }, (_, index) => (
        <Card key={index} className="px-2 py-2 sm:px-4 sm:py-3">
          <Skeleton className="h-3 w-10 sm:w-16" />
          <Skeleton className="mt-2 h-5 w-6 sm:h-7 sm:w-10" />
        </Card>
      ))}
    </div>
  );
}

function ConnectionStatusBadge({ status }: { status: LivemopayConnectionStatus | null }) {
  if (!status) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted">
        <span className="h-1.5 w-1.5 rounded-full bg-muted/50" aria-hidden="true" />
        Never connected
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-ink">
      <span className={`h-1.5 w-1.5 rounded-full ${connectionStatusDotClass[status]}`} aria-hidden="true" />
      {connectionStatusLabel[status]}
    </span>
  );
}

function SortHeaderButton({
  label,
  shortLabel,
  active,
  direction,
  onClick
}: {
  label: string;
  shortLabel?: string;
  active: boolean;
  direction: "asc" | "desc";
  onClick: () => void;
}) {
  return (
    <button
      className="inline-flex items-center font-medium uppercase tracking-[0.16em] transition hover:text-ink"
      onClick={onClick}
      type="button"
      aria-label={`Sort by ${label}`}
    >
      {shortLabel ? (
        <>
          <span className="sm:hidden">{shortLabel}</span>
          <span className="hidden sm:inline">{label}</span>
        </>
      ) : (
        label
      )}
      {/* Same convention as the data table: a faint up/down icon marks a column
          as sortable; the active column shows its actual direction. */}
      {!active ? (
        <ArrowUpDown aria-hidden="true" className="ml-1 h-3.5 w-3.5 text-muted/55" />
      ) : direction === "asc" ? (
        <ArrowUp aria-hidden="true" className="ml-1 h-3.5 w-3.5 text-ink" />
      ) : (
        <ArrowDown aria-hidden="true" className="ml-1 h-3.5 w-3.5 text-ink" />
      )}
    </button>
  );
}

function FeatureChips({ user }: { user: AdminUserListItem }) {
  const enabled = FEATURES.filter((feature) => user[feature.key]);

  if (enabled.length === 0) {
    return (
      <span className="inline-flex items-center rounded-full border border-line bg-canvas px-2.5 py-0.5 text-xs font-medium text-muted">
        None
      </span>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {enabled.map((feature) => (
        <span
          key={feature.key}
          className="inline-flex items-center rounded-full border border-accent/30 bg-accentSoft px-2.5 py-0.5 text-xs font-medium text-brandTeal dark:text-accent"
        >
          {feature.short}
        </span>
      ))}
    </div>
  );
}

async function fetchAdminUsers() {
  const response = await fetch(apiEndpoints.adminUsers, { cache: "no-store" });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || "Failed to load users.");
  }

  return (await response.json()) as AdminUsersApiResponse;
}

function TableSkeletonRows({ rowCount }: { rowCount: number }) {
  return (
    <>
      {Array.from({ length: rowCount }, (_, rowIndex) => (
        <tr key={`skeleton-${rowIndex}`}>
          <td className="px-4 py-3">
            <Skeleton className="h-4 w-40" />
          </td>
          <td className="px-4 py-3">
            <Skeleton className="h-4 w-20" />
          </td>
          <td className="px-4 py-3">
            <Skeleton className="h-8 w-28" />
          </td>
          <td className="px-4 py-3">
            <Skeleton className="h-6 w-32" />
          </td>
          <td className="px-4 py-3">
            <Skeleton className="h-4 w-24" />
          </td>
          <td className="px-4 py-3">
            <Skeleton className="h-4 w-24" />
          </td>
        </tr>
      ))}
    </>
  );
}

type FeatureDraft = Record<FeatureKey, boolean>;

function draftFromUser(user: AdminUserListItem): FeatureDraft {
  return {
    aiAssistantEnabled: user.aiAssistantEnabled,
    activitiesEnabled: user.activitiesEnabled,
    liveMeterEnabled: user.liveMeterEnabled
  };
}

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-line px-4 py-3 last:border-b-0">
      <span className="text-sm text-muted">{label}</span>
      <span className="text-sm font-medium text-ink">{children}</span>
    </div>
  );
}

type ManageDrawerProps = {
  user: AdminUserListItem;
  isSelf: boolean;
  saving: boolean;
  error: string;
  onClose: () => void;
  // Resolves true when the save succeeded, so the drawer can animate itself out.
  onSave: (changes: Partial<FeatureDraft>) => Promise<boolean>;
};

// Exit animation duration; keep in sync with the transition classes below.
const DRAWER_ANIM_MS = 220;

function ManageDrawer({ user, isSelf, saving, error, onClose, onSave }: ManageDrawerProps) {
  const [draft, setDraft] = useState<FeatureDraft>(() => draftFromUser(user));
  // Drives the slide-in / slide-out. Starts closed, then flips open on the next
  // frame so the browser animates the transform rather than snapping to it.
  const [visible, setVisible] = useState(false);
  const [copied, setCopied] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  async function copyEmail() {
    if (!user.email) {
      return;
    }
    try {
      await navigator.clipboard.writeText(user.email);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be unavailable (insecure context / denied); silently ignore.
    }
  }

  const requestClose = useCallback(() => {
    setVisible(false);
    window.setTimeout(onClose, DRAWER_ANIM_MS); // unmount after the slide-out
  }, [onClose]);

  // Lock body scroll, animate in, focus the close button, close on Escape.
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const raf = requestAnimationFrame(() => setVisible(true));
    closeButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) {
        requestClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [requestClose, saving]);

  const dirty = FEATURES.some((feature) => draft[feature.key] !== user[feature.key]);

  async function handleSave() {
    const changes: Partial<FeatureDraft> = {};
    for (const feature of FEATURES) {
      if (draft[feature.key] !== user[feature.key]) {
        changes[feature.key] = draft[feature.key];
      }
    }
    const ok = await onSave(changes);
    if (ok) {
      requestClose();
    }
  }

  return (
    <div
      className="fixed inset-0 z-50"
      role="dialog"
      aria-modal="true"
      aria-label={`Manage access for ${user.email ?? "user"}`}
    >
      <button
        type="button"
        aria-label="Close"
        onClick={() => !saving && requestClose()}
        className={`absolute inset-0 h-full w-full cursor-default bg-ink/10 backdrop-blur-md transition-opacity duration-200 motion-reduce:transition-none ${
          visible ? "opacity-100" : "opacity-0"
        }`}
      />
      <aside
        className={`absolute right-0 top-0 flex h-full w-[min(28rem,92vw)] flex-col border-l border-line bg-paper shadow-soft transition-transform duration-200 ease-out motion-reduce:transition-none ${
          visible ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="flex min-w-0 flex-1 items-start gap-1.5">
            <h2 className="min-w-0 break-all text-base font-semibold leading-6 text-ink">
              {user.email ?? "Unknown user"}
            </h2>
            {user.email ? (
              <button
                type="button"
                aria-label={copied ? "Email copied" : "Copy email"}
                title={copied ? "Copied" : "Copy email"}
                onClick={() => void copyEmail()}
                className="flex h-6 shrink-0 items-center rounded text-muted outline-none transition hover:text-ink focus-visible:ring-1 focus-visible:ring-line"
              >
                {copied ? <Check className="h-4 w-4 text-accent" /> : <Copy className="h-4 w-4" />}
              </button>
            ) : null}
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            aria-label="Close"
            onClick={() => !saving && requestClose()}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-line bg-canvas text-muted transition hover:text-ink"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-5 py-5">
          <section className="mb-6">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted">Account</h3>
            <div className="overflow-hidden rounded-lg border border-line">
              <InfoRow label="Joined">{new Date(user.createdAt).toLocaleDateString()}</InfoRow>
              <InfoRow label="Role">{user.role === "admin" ? "Admin" : "User"}</InfoRow>
              <InfoRow label="LiveMopay">
                <ConnectionStatusBadge status={user.connectionStatus} />
              </InfoRow>
              <InfoRow label="Last sync">
                <LastSyncCell user={user} />
              </InfoRow>
            </div>
          </section>

          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted">Features</h3>
            <div className="overflow-hidden rounded-lg border border-line">
              {FEATURES.map((feature) => (
                <div
                  key={feature.key}
                  className="flex items-center justify-between gap-4 border-b border-line px-4 py-3.5 last:border-b-0"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink">{feature.name}</p>
                    <p className="mt-1 text-xs text-muted">{feature.description}</p>
                  </div>
                  <Switch
                    ariaLabel={`${feature.name} for ${user.email ?? "user"}`}
                    checked={draft[feature.key]}
                    onChange={(checked) => setDraft((current) => ({ ...current, [feature.key]: checked }))}
                    disabled={saving}
                  />
                </div>
              ))}
            </div>
            {isSelf ? <p className="mt-3 text-xs text-muted">Editing your own feature access.</p> : null}
            {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
          </section>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-line px-5 py-4">
          <button
            type="button"
            onClick={requestClose}
            disabled={saving}
            className="rounded-md border border-line bg-canvas px-4 py-2 text-sm font-medium text-ink transition hover:bg-paper disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !dirty}
            className="rounded-md bg-brandTeal px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50 dark:bg-accent dark:text-canvas"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </aside>
    </div>
  );
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

  // The whole list, fetched once. Supabase Auth's admin API has no
  // sort/filter params of its own -- paginating "server-side" would just
  // mean refetching this same full list on every click for no benefit.
  // Sorting/pagination (if ever needed again) happens client-side instead.
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
      const response = await fetch(`/api/admin/users/${userId}/role`, {
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

  // Batched feature save: one PATCH with only the changed flags, matching the
  // permissions endpoint's partial-body contract. Optimistic, reverted on error.
  // Returns true on success so the drawer can play its slide-out before the
  // parent unmounts it.
  async function handleSaveFeatures(userId: string, changes: Partial<FeatureDraft>): Promise<boolean> {
    if (Object.keys(changes).length === 0) {
      return true; // nothing changed; let the drawer animate closed
    }

    const target = users.find((user) => user.userId === userId);
    if (!target) {
      return false;
    }
    const previous: Partial<AdminUserListItem> = {};
    for (const key of Object.keys(changes) as FeatureKey[]) {
      previous[key] = target[key];
    }

    setDrawerError("");
    setDrawerSaving(true);
    patchLocalUser(userId, changes);

    try {
      const response = await fetch(`/api/admin/users/${userId}/permissions`, {
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
      patchLocalUser(userId, previous);
      setDrawerSaving(false);
      setDrawerError(caught instanceof Error ? caught.message : "Couldn't update features.");
      return false;
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      {showTableSkeleton ? (
        <StatStripSkeleton />
      ) : (
        <div className="grid grid-cols-4 gap-2 sm:gap-3">
          <StatTile label="Total users" value={total} />
          <StatTile label="Connected" value={stats.connected} />
          <StatTile label="Active (7d)" value={stats.active} />
          <StatTile label="Needs help" value={stats.needsHelp} tone="warning" />
        </div>
      )}

      <Card className="flex h-0 min-h-0 flex-1 flex-col overflow-hidden">
        <div className="relative min-h-0 flex-1">
          <div className="h-full overflow-auto" ref={tableScrollRef}>
            <table className="w-full min-w-[760px] border-separate border-spacing-0 text-left text-sm">
              <thead className="sticky top-0 z-10 border-b border-line bg-accentSoft text-xs uppercase tracking-[0.16em] text-brandTeal dark:text-accent shadow-[0_1px_0_rgb(var(--color-line))]">
                <tr>
                  <th className="px-4 py-3 font-medium">User</th>
                  <th className="px-4 py-3 font-medium">
                    <SortHeaderButton
                      label="Joined"
                      active={sortKey === "joined"}
                      direction={sortDirection}
                      onClick={() => onSortChange("joined")}
                    />
                  </th>
                  <th className="px-4 py-3 font-medium">Role</th>
                  <th className="px-4 py-3 font-medium">Features</th>
                  <th className="px-4 py-3 font-medium">LiveMopay</th>
                  <th className="px-4 py-3 font-medium">
                    <SortHeaderButton
                      label="Last sync"
                      shortLabel="Sync"
                      active={sortKey === "lastSync"}
                      direction={sortDirection}
                      onClick={() => onSortChange("lastSync")}
                    />
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {showTableSkeleton ? (
                  <TableSkeletonRows rowCount={8} />
                ) : (
                  users.map((user) => {
                    const isSelf = user.userId === currentUserId;
                    const isUserPending = pendingUserId === user.userId;
                    const rowError = errorByUserId[user.userId];
                    const isActive = user.userId === selectedUserId;

                    return (
                      <tr
                        key={user.userId}
                        onClick={() => openDrawer(user.userId)}
                        className={`group cursor-pointer transition hover:bg-canvas/70 ${isActive ? "bg-accentSoft/50" : ""}`}
                      >
                        <td className="px-4 py-3">
                          <p className="text-ink">{user.email ?? "Unknown"}</p>
                          {isSelf ? <p className="text-xs text-muted">This is you</p> : null}
                          {rowError ? <p className="text-xs text-red-600">{rowError}</p> : null}
                        </td>
                        <td className="px-4 py-3 text-muted">{new Date(user.createdAt).toLocaleDateString()}</td>
                        {/* Role stays inline-editable; stop the click bubbling so
                            changing the role doesn't also open the drawer. */}
                        <td className="px-4 py-3" onClick={(event) => event.stopPropagation()}>
                          <DropdownSelect
                            ariaLabel={`Role for ${user.email ?? user.userId}`}
                            value={user.role}
                            options={
                              isSelf
                                ? roleOptions.map((option) =>
                                    option.value === "user" ? { ...option, disabled: true } : option
                                  )
                                : roleOptions
                            }
                            onChange={(value) => void handleRoleChange(user.userId, value as UserRole)}
                            loading={isUserPending}
                            className="w-28"
                          />
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <FeatureChips user={user} />
                            {/* Sleek ghost affordance: hidden until the row is
                                hovered, but revealed on keyboard focus so it
                                stays the accessible trigger. Touch users open
                                via the row tap. */}
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
                        </td>
                        <td className="px-4 py-3">
                          <ConnectionStatusBadge status={user.connectionStatus} />
                        </td>
                        <td className="px-4 py-3">
                          <LastSyncCell user={user} />
                        </td>
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
      </Card>

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
