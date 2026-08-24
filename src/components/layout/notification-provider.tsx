"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { NotificationItem } from "@/lib/newinmeter/alerts";

type NotificationCentreState = {
  unreadCount: number;
  notifications: NotificationItem[];
  listLoading: boolean;
  markingAllRead: boolean;
  isDesktop: boolean;
  // Fetches the list once per app session (first time any trigger -- desktop
  // or mobile -- opens the centre); later opens reuse this same state
  // instead of refetching, and mutations below patch it in place.
  ensureLoaded: () => void;
  markOneRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
};

const NotificationCentreContext = createContext<NotificationCentreState | null>(null);

async function syncAppBadge(count: number) {
  if (typeof navigator === "undefined" || !("setAppBadge" in navigator)) {
    return;
  }
  try {
    if (count > 0) {
      await navigator.setAppBadge(count);
    } else if ("clearAppBadge" in navigator) {
      await navigator.clearAppBadge();
    }
  } catch {
    // Best-effort -- badge support is inconsistent across browsers and this
    // must never block the notification centre itself.
  }
}

// One logical notification-data owner per authenticated app session. The
// header renders TWO visual bell triggers (desktop sidebar + mobile header,
// see app-shell.tsx) because the responsive layout needs two entry points,
// but `display:none`/Tailwind breakpoints don't unmount the hidden one --
// without this provider each trigger ran its own fetch-on-open, its own
// badge-reconciliation effect, and its own independent copy of
// unreadCount/notifications, which could visibly disagree with each other
// (mark-read on mobile wouldn't be reflected if you then resized to desktop
// and opened the popover there). This provider is the single source of
// truth both triggers read from and mutate through.
export function NotificationProvider({
  initialUnreadCount,
  children
}: {
  initialUnreadCount: number;
  children: ReactNode;
}) {
  const [unreadCount, setUnreadCount] = useState(initialUnreadCount);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [markingAllRead, setMarkingAllRead] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const hasLoadedRef = useRef(false);
  const loadingRef = useRef(false);

  // Single badge-reconciliation effect for the whole authenticated session
  // (was previously one per bell instance -- see module comment above).
  useEffect(() => {
    void syncAppBadge(unreadCount);
  }, [unreadCount]);

  // Single matchMedia listener shared by both triggers, instead of one per
  // mounted (visible-or-not) bell instance.
  useEffect(() => {
    const query = window.matchMedia("(min-width: 1024px)");
    setIsDesktop(query.matches);
    const onChange = (event: MediaQueryListEvent) => setIsDesktop(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  const ensureLoaded = useCallback(() => {
    if (hasLoadedRef.current || loadingRef.current) {
      return;
    }
    loadingRef.current = true;
    setListLoading(true);
    fetch("/api/notifications")
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { notifications?: NotificationItem[] } | null) => {
        if (!body) return;
        const list = body.notifications ?? [];
        setNotifications(list);
        setUnreadCount(list.filter((item) => !item.isRead).length);
        hasLoadedRef.current = true;
      })
      .finally(() => {
        setListLoading(false);
        loadingRef.current = false;
      });
  }, []);

  const markOneRead = useCallback(async (id: string) => {
    let alreadyRead = true;
    setNotifications((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        alreadyRead = item.isRead;
        return { ...item, isRead: true };
      })
    );
    if (alreadyRead) return;

    setUnreadCount((count) => Math.max(0, count - 1));
    try {
      await fetch(`/api/notifications/${id}/read`, { method: "POST" });
    } catch {
      // Best-effort: optimistic local state stands; a stale server read_at
      // self-corrects on the next full list load, not worth reverting for.
    }
  }, []);

  const markAllRead = useCallback(async () => {
    if (markingAllRead || unreadCount === 0) return;

    const previousNotifications = notifications;
    const previousCount = unreadCount;

    setMarkingAllRead(true);
    setNotifications((prev) => prev.map((item) => ({ ...item, isRead: true })));
    setUnreadCount(0);

    try {
      const response = await fetch("/api/notifications/read-all", { method: "POST" });
      if (!response.ok) {
        throw new Error("Failed to mark all as read.");
      }
    } catch {
      setNotifications(previousNotifications);
      setUnreadCount(previousCount);
    } finally {
      setMarkingAllRead(false);
    }
  }, [markingAllRead, notifications, unreadCount]);

  const value = useMemo<NotificationCentreState>(
    () => ({
      unreadCount,
      notifications,
      listLoading,
      markingAllRead,
      isDesktop,
      ensureLoaded,
      markOneRead,
      markAllRead
    }),
    [unreadCount, notifications, listLoading, markingAllRead, isDesktop, ensureLoaded, markOneRead, markAllRead]
  );

  return <NotificationCentreContext.Provider value={value}>{children}</NotificationCentreContext.Provider>;
}

export function useNotificationCentre(): NotificationCentreState {
  const context = useContext(NotificationCentreContext);
  if (!context) {
    throw new Error("useNotificationCentre must be used within a NotificationProvider");
  }
  return context;
}
