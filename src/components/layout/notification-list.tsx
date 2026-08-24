"use client";

import { BellRing, Sparkles } from "lucide-react";
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
  // null while the first load is still in flight -- distinct from `false`
  // so the empty state doesn't flash "all caught up" then swap to the
  // Settings prompt a moment later.
  hasEnabledAlerts?: boolean | null;
  onGoToSettings?: () => void;
  // Ask AI is only rendered when both the AI feature is on for this account
  // and a handler is supplied -- omit either and the row stays exactly as
  // before (view/navigate only).
  isAiAssistantEnabled?: boolean;
  onAskAi?: (item: NotificationItem) => void;
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
  showHeader = true,
  hasEnabledAlerts = null,
  onGoToSettings,
  isAiAssistantEnabled = false,
  onAskAi
}: NotificationListProps) {
  const unreadCount = notifications.filter((item) => !item.isRead).length;
  const showAskAi = isAiAssistantEnabled && Boolean(onAskAi);

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
        ) : notifications.length === 0 && hasEnabledAlerts === false ? (
          // No alert_events AND nothing is even enabled to produce one --
          // different from "configured, just hasn't fired" (below), so this
          // points at Settings instead of implying anything is being
          // watched.
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
            <BellRing aria-hidden="true" className="h-5 w-5 text-muted/60" />
            <p className="text-sm font-medium text-ink">No alerts set up yet.</p>
            <p className="text-xs text-muted">Turn one on to start getting notified here.</p>
            <button
              className="mt-2 rounded text-[0.8125rem] font-medium text-accent outline-none transition hover:text-ink"
              onClick={onGoToSettings}
              type="button"
            >
              Set up an alert
            </button>
          </div>
        ) : notifications.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
            <BellRing aria-hidden="true" className="h-5 w-5 text-muted/60" />
            <p className="text-sm font-medium text-ink">You&apos;re all caught up.</p>
            <p className="text-xs text-muted">NewinMeter will keep important alerts here.</p>
          </div>
        ) : (
          <ul>
            {notifications.map((item) => (
              <li className="relative" key={item.id}>
                <button
                  className={`flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-canvas ${
                    showAskAi ? "pr-11" : ""
                  } ${item.isRead ? "" : "bg-accentSoft/40"}`}
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
                    <span className="mt-1 block text-xs text-muted/80">{formatNotificationTime(item.triggeredAt)}</span>
                  </span>
                </button>
                {showAskAi ? (
                  <button
                    aria-label={`Ask AI about: ${item.title}`}
                    className="absolute right-2 top-2.5 inline-flex h-7 w-7 items-center justify-center rounded-full text-muted transition hover:bg-canvas hover:text-accent"
                    onClick={() => onAskAi?.(item)}
                    title="Ask AI"
                    type="button"
                  >
                    <Sparkles aria-hidden="true" className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
