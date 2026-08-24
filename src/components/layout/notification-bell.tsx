"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Bell } from "lucide-react";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import type { NotificationItem } from "@/lib/newinmeter/alerts";
import { MarkAllReadButton, NotificationList } from "./notification-list";
import { useNotificationCentre } from "./notification-provider";

const POPOVER_WIDTH = 360;
const POPOVER_MARGIN = 12;

function badgeLabel(count: number): string {
  // Capped at a single extra character ("9+") rather than a two-digit
  // ceiling -- keeps the badge exactly the same tiny footprint regardless
  // of how large the real count gets, which matters more than precision at
  // the size this renders on a narrow phone.
  return count > 9 ? "9+" : String(count);
}

// One of two visual triggers for the single shared notification centre (see
// notification-provider.tsx) -- desktop sidebar + mobile header each render
// their own instance because the responsive layout needs two entry points,
// but all data (unreadCount, notifications, mutations, badge sync) comes
// from the shared NotificationProvider so both stay in sync. Only open/closed
// presentation state (isOpen, popover position) is local to each instance --
// opening one never affects the other.
export function NotificationBell() {
  const router = useRouter();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const { unreadCount, notifications, listLoading, markingAllRead, isDesktop, ensureLoaded, markOneRead, markAllRead } =
    useNotificationCentre();

  const [isOpen, setIsOpen] = useState(false);
  const [popoverPosition, setPopoverPosition] = useState({ top: 0, left: 0 });

  const handleOpen = useCallback(() => {
    setIsOpen(true);
    ensureLoaded();
  }, [ensureLoaded]);

  // Desktop popover position, portaled off the button's own rect -- same
  // pattern as SyncButton/MetricCard's popovers (fixed position computed
  // from getBoundingClientRect, recalculated on resize/scroll).
  useEffect(() => {
    if (!isOpen || !isDesktop || !buttonRef.current) {
      return;
    }

    const updatePosition = () => {
      if (!buttonRef.current) return;
      const rect = buttonRef.current.getBoundingClientRect();
      const left = Math.min(
        window.innerWidth - POPOVER_WIDTH - POPOVER_MARGIN,
        Math.max(POPOVER_MARGIN, rect.right - POPOVER_WIDTH)
      );
      setPopoverPosition({ top: rect.bottom + 8, left });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [isOpen, isDesktop]);

  useEffect(() => {
    if (!isOpen || !isDesktop) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target)) return;
      const panel = document.getElementById("notification-centre-popover");
      if (panel?.contains(target)) return;
      setIsOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, isDesktop]);

  // Closing this instance's own panel never touches the other trigger's
  // isOpen -- each instance's open/closed state is local, only the
  // underlying data is shared.
  async function handleItemClick(item: NotificationItem) {
    setIsOpen(false);

    if (!item.isRead) {
      // Awaited (not fire-and-forget) so the read state is actually
      // persisted before navigating away -- "mark it read before
      // navigating", not "navigate and hope the request lands".
      await markOneRead(item.id);
    }

    router.push(item.url);
  }

  const accessibleLabel = unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications";

  const bellButton = (
    <button
      aria-expanded={isOpen}
      aria-haspopup="dialog"
      aria-label={accessibleLabel}
      className="relative inline-flex h-9 w-9 items-center justify-center rounded-md text-muted outline-none transition hover:bg-canvas hover:text-ink focus-visible:ring-1 focus-visible:ring-line"
      onClick={() => (isOpen ? setIsOpen(false) : handleOpen())}
      ref={buttonRef}
      type="button"
    >
      <Bell aria-hidden="true" className="h-[1.125rem] w-[1.125rem]" />
      {unreadCount > 0 ? (
        <span
          aria-hidden="true"
          className="absolute right-1 top-1 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-accent px-1 text-[0.625rem] font-semibold leading-none text-white"
        >
          {badgeLabel(unreadCount)}
        </span>
      ) : null}
    </button>
  );

  return (
    <>
      {bellButton}

      {isOpen && isDesktop
        ? createPortal(
            <div
              className="fixed z-50 flex max-h-[28rem] flex-col overflow-hidden rounded-xl border border-line bg-paper shadow-soft"
              id="notification-centre-popover"
              role="dialog"
              style={{ top: popoverPosition.top, left: popoverPosition.left, width: POPOVER_WIDTH }}
            >
              <NotificationList
                loading={listLoading}
                markingAllRead={markingAllRead}
                notifications={notifications}
                onItemClick={(item) => void handleItemClick(item)}
                onMarkAllRead={() => void markAllRead()}
              />
            </div>,
            document.body
          )
        : null}

      {isOpen && !isDesktop ? (
        <BottomSheet
          headerAction={
            <MarkAllReadButton markingAllRead={markingAllRead} onMarkAllRead={() => void markAllRead()} unreadCount={unreadCount} />
          }
          isOpen={isOpen}
          onClose={() => setIsOpen(false)}
          title="Notifications"
        >
          <NotificationList
            loading={listLoading}
            markingAllRead={markingAllRead}
            notifications={notifications}
            onItemClick={(item) => void handleItemClick(item)}
            onMarkAllRead={() => void markAllRead()}
            showHeader={false}
          />
        </BottomSheet>
      ) : null}
    </>
  );
}
