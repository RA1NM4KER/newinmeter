"use client";

import { BellRing } from "lucide-react";
import { formatNotificationTime } from "@/lib/notifications/format";
import type { NotificationItem } from "@/lib/newinmeter/alerts";

type NotificationListProps = {
  notifications: NotificationItem[];
  loading: boolean;
  markingAllRead: boolean;
  onItemClick: (item: NotificationItem) => void;
  onMarkAllRead: () => void;
  // False when the container already renders its own title/action row (the
  // mobile BottomSheet does, via its headerAction slot) -- avoids rendering
  // "Notifications" / "Mark all as read" twice.
  showHeader?: boolean;
};

// Only shown when there's something to mark -- "Mark all as read" has no
// reason to exist, enabled or not, when nothing is unread.
export function MarkAllReadButton({
  unreadCount,
  markingAllRead,
  onMarkAllRead
}: {
  unreadCount: number;
  markingAllRead: boolean;
  onMarkAllRead: () => void;
}) {
  if (unreadCount === 0) {
    return null;
  }

  return (
    <button
      className="rounded text-xs font-medium text-accent outline-none transition hover:text-ink disabled:pointer-events-none disabled:opacity-50"
      disabled={markingAllRead}
      onClick={onMarkAllRead}
      type="button"
    >
      Mark all as read
    </button>
  );
}

// Shared row list used by both the desktop popover and the mobile
// BottomSheet -- one implementation, two containers. Deliberately compact:
// no severity colours, no cards-within-cards, just title/body/time rows
// with a small unread dot -- this is a notification centre, not an inbox.
export function NotificationList({
  notifications,
  loading,
  markingAllRead,
  onItemClick,
  onMarkAllRead,
  showHeader = true
}: NotificationListProps) {
  const unreadCount = notifications.filter((item) => !item.isRead).length;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {showHeader ? (
        <div className="flex shrink-0 items-center justify-between gap-3 px-4 py-3">
          <h2 className="text-sm font-semibold text-ink">Notifications</h2>
          <MarkAllReadButton markingAllRead={markingAllRead} onMarkAllRead={onMarkAllRead} unreadCount={unreadCount} />
        </div>
      ) : null}

      <div className={`min-h-0 flex-1 overflow-auto ${showHeader ? "border-t border-line" : ""}`}>
        {loading ? (
          <div className="px-4 py-8 text-center text-sm text-muted">Loading…</div>
        ) : notifications.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
            <BellRing aria-hidden="true" className="h-5 w-5 text-muted/60" />
            <p className="text-sm font-medium text-ink">You&apos;re all caught up.</p>
            <p className="text-xs text-muted">NewinMeter will keep important alerts here.</p>
          </div>
        ) : (
          <ul>
            {notifications.map((item) => (
              <li key={item.id}>
                <button
                  className={`flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-canvas ${
                    item.isRead ? "" : "bg-accentSoft/40"
                  }`}
                  onClick={() => onItemClick(item)}
                  type="button"
                >
                  <span
                    aria-hidden="true"
                    className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${item.isRead ? "bg-transparent" : "bg-accent"}`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[0.8125rem] font-medium text-ink">
                      {item.title}
                      {!item.isRead ? <span className="sr-only"> (unread)</span> : null}
                    </span>
                    <span className="mt-0.5 block text-[0.8125rem] leading-snug text-muted">{item.body}</span>
                    <span className="mt-1 block text-xs text-muted/80">
                      {formatNotificationTime(item.triggeredAt)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
