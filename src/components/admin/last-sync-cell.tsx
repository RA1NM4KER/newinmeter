import type { AdminUserListItem, CaptureRunStatus } from "@/lib/user-roles";

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

export function LastSyncCell({ user }: { user: AdminUserListItem }) {
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
