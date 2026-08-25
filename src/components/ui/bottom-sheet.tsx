"use client";

import { X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

// Exit animation duration; keep in sync with the transition classes below.
const SHEET_ANIM_MS = 220;

type BottomSheetProps = {
  isOpen: boolean;
  onClose(): void;
  title: string;
  children: ReactNode;
  // Optional control rendered in the header, between the title and the
  // close button (e.g. NotificationBell's "Mark all as read") -- so a
  // consumer with its own header-level action doesn't need to duplicate
  // this sheet's title row just to add one.
  headerAction?: ReactNode;
  // Short sheets such as the mobile menu need less vertical padding than
  // notification/install content. Keep the default unchanged for every
  // existing consumer and opt into the tighter spacing explicitly.
  contentPadding?: "default" | "compact";
};

// Bottom-anchored counterpart to FullscreenDialog -- for menus/content short
// enough that taking over the whole screen would leave obvious dead space
// below it. Animation plumbing (visible state + rAF-triggered transition +
// timeout-delayed unmount, body-scroll lock, Escape-to-close) mirrors
// ManageDrawer, just with the slide axis swapped from X to Y.
export function BottomSheet({
  isOpen,
  onClose,
  title,
  children,
  headerAction,
  contentPadding = "default"
}: BottomSheetProps) {
  const [visible, setVisible] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  const requestClose = useCallback(() => {
    setVisible(false);
    window.setTimeout(onClose, SHEET_ANIM_MS);
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const raf = requestAnimationFrame(() => setVisible(true));
    closeButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        requestClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, requestClose]);

  if (!isOpen) {
    return null;
  }

  // Portaled to document.body -- some callers (e.g. NotificationBell's
  // mobile trigger) render this from inside a `transform`-animated ancestor
  // (the scroll-hiding mobile header), and per spec any `transform` on an
  // ancestor creates a new containing block for `position: fixed`
  // descendants. Without the portal, "fixed inset-0" resolves against that
  // small transformed header box instead of the real viewport, collapsing
  // the whole sheet to a sliver with no backdrop. Portaling out to <body>
  // (same pattern the desktop notification popover already uses) makes this
  // correct regardless of what any future caller's ancestor tree looks like.
  return createPortal(
    <div aria-modal="true" className="fixed inset-0 z-50" role="dialog">
      <button
        aria-label="Close"
        className={`absolute inset-0 h-full w-full cursor-default bg-ink/10 backdrop-blur-md transition-opacity duration-200 motion-reduce:transition-none ${
          visible ? "opacity-100" : "opacity-0"
        }`}
        onClick={requestClose}
        type="button"
      />
      <div
        className={`absolute inset-x-0 bottom-0 flex max-h-[80vh] flex-col rounded-t-2xl border-t border-line bg-paper shadow-soft transition-transform duration-200 ease-out motion-reduce:transition-none ${
          visible ? "translate-y-0" : "translate-y-full"
        }`}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-5 py-4">
          <h2 className="text-base font-semibold text-ink">{title}</h2>
          <div className="flex shrink-0 items-center gap-3">
            {headerAction}
            <button
              aria-label="Close"
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-line bg-canvas text-muted transition hover:text-ink"
              onClick={requestClose}
              ref={closeButtonRef}
              type="button"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div
          className={`min-h-0 flex-1 overflow-auto px-5 ${
            contentPadding === "compact"
              ? "pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-4"
              : "pb-[calc(env(safe-area-inset-bottom)+1.25rem)] pt-5"
          }`}
        >
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
}
