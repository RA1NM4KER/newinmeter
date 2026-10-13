import type { ConnectionLifecycle } from "@/lib/connection-lifecycle";
import type { AdminUserListItem } from "@/lib/user-roles";

type AutoSyncUser = Pick<
  AdminUserListItem,
  "autoSyncEnabled" | "connectionLifecycle" | "nextSyncAt" | "lastAutoSyncStatus"
>;
const inactiveLabels: Partial<Record<ConnectionLifecycle, string>> = {
  paused: "Paused · inactivity",
  cold: "Inactive · cold storage",
  hibernating: "Inactive · cold-storage purge",
  restoring: "Paused · restoring data",
  restore_failed: "Inactive · restoration failed"
};

export function AutoSyncStatus({ user }: { user: AutoSyncUser }) {
  if (user.autoSyncEnabled === null) return <span className="text-xs text-muted">No connection</span>;
  const lifecycleLabel = user.connectionLifecycle ? inactiveLabels[user.connectionLifecycle] : undefined;
  if (lifecycleLabel) return <span className="text-xs text-muted">{lifecycleLabel}</span>;
  if (!user.autoSyncEnabled) return <span className="text-xs text-muted">Off</span>;
  return (
    <span className="text-xs text-ink">
      On
      {user.nextSyncAt ? ` · next ${new Date(user.nextSyncAt).toLocaleString()}` : " · not scheduled"}
      {user.lastAutoSyncStatus === "failed" ? " · last attempt failed" : ""}
    </span>
  );
}
