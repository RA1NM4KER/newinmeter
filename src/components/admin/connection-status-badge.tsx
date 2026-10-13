import type { LivemopayConnectionStatus } from "@/lib/user-roles";

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

export function ConnectionStatusBadge({ status }: { status: LivemopayConnectionStatus | null }) {
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
