import type { AdminUserListItem } from "@/lib/user-roles";

export function inactivityDuration(lastActiveAt: string, now = Date.now()) {
  const minutes = Math.max(0, Math.floor((now - Date.parse(lastActiveAt)) / 60000));
  if (minutes < 1) return "Less than a minute";
  const value = minutes < 60 ? minutes : minutes < 1440 ? Math.floor(minutes / 60) : Math.floor(minutes / 1440);
  const unit = minutes < 60 ? "minute" : minutes < 1440 ? "hour" : "day";
  return `${value} ${unit}${value === 1 ? "" : "s"}`;
}
const dateTime = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Africa/Johannesburg",
  dateStyle: "medium",
  timeStyle: "short"
});
export function InactiveFor({ user }: { user: Pick<AdminUserListItem, "lastActiveAt" | "inactivitySource"> }) {
  if (!user.lastActiveAt || !Number.isFinite(Date.parse(user.lastActiveAt)))
    return <span className="text-xs text-muted">Unknown</span>;
  const source =
    user.inactivitySource === "foreground"
      ? "Last foreground activity"
      : user.inactivitySource === "connection"
        ? "Fallback: connection time"
        : "Fallback: last sign-in";
  return (
    <span className="text-xs text-ink" title={`${source}: ${dateTime.format(new Date(user.lastActiveAt))} SAST`}>
      {inactivityDuration(user.lastActiveAt)}
    </span>
  );
}
