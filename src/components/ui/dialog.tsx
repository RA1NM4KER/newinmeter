"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { getFocusable, resolveTrapFocusIndex } from "./focus-trap";

type DialogProps = {
  isOpen: boolean;
  onClose(): void;
  title: string;
  eyebrow?: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
};

export function Dialog({ isOpen, onClose, title, eyebrow, description, children, footer }: DialogProps) {
  const [mounted, setMounted] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | SVGElement | null>(null);
  const titleId = useId();

  useEffect(() => setMounted(true), []);

  // Focus management: capture the opener so it can be restored on close,
  // move focus into the dialog on open (an explicit [data-autofocus]
  // element if the caller marked one, otherwise the first focusable
  // control), and trap Tab/Shift+Tab so the background page -- which sits
  // right underneath this overlay -- never becomes keyboard-reachable
  // while the dialog is open.
  useEffect(() => {
    if (!isOpen) return;

    previouslyFocusedRef.current =
      document.activeElement instanceof HTMLElement || document.activeElement instanceof SVGElement
        ? document.activeElement
        : null;

    const focusInitialElement = () => {
      // Deliberately scoped to the content area, not the whole dialog --
      // the header's close button comes first in DOM order, and landing
      // keyboard focus there instead of the first field would be a poor
      // (if technically "focused") default.
      const content = contentRef.current;
      if (!content) return;
      const explicit = content.querySelector<HTMLElement>("[data-autofocus]");
      const target = explicit ?? getFocusable(content)[0];
      target?.focus();
    };

    // The portal's children mount in the same tick this effect runs, but
    // give layout a frame so offsetParent-based visibility checks in
    // getFocusable are accurate before we pick the first control.
    const raf = requestAnimationFrame(focusInitialElement);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }

      if (event.key !== "Tab") return;

      const container = containerRef.current;
      if (!container) return;

      const focusable = getFocusable(container);
      if (!focusable.length) {
        event.preventDefault();
        return;
      }

      const active = document.activeElement;
      const activeIndex = active instanceof HTMLElement ? focusable.indexOf(active) : -1;
      const targetIndex = resolveTrapFocusIndex(focusable.length, activeIndex, event.shiftKey);

      if (targetIndex !== -1) {
        event.preventDefault();
        focusable[targetIndex].focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);

    return () => {
      cancelAnimationFrame(raf);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown, true);

      const opener = previouslyFocusedRef.current;
      if (opener && document.contains(opener)) {
        opener.focus();
      }
    };
  }, [isOpen, onClose]);

  if (!mounted || !isOpen) return null;

  return createPortal(
    <div
      aria-labelledby={titleId}
      aria-modal="true"
      className="fullscreen-glass fixed inset-0 z-[60] flex flex-col"
      ref={containerRef}
      role="dialog"
    >
      <header className="flex shrink-0 items-start justify-between gap-3 border-b border-line bg-paper/95 px-4 py-2.5 sm:px-6">
        <div className="min-w-0">
          {eyebrow ? <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted">{eyebrow}</p> : null}
          <h2 id={titleId} className={`${eyebrow ? "mt-0.5" : ""} text-base font-semibold text-ink sm:text-lg`}>
            {title}
          </h2>
          {description ? <p className="mt-0.5 text-xs text-muted">{description}</p> : null}
        </div>
        <button
          aria-label="Close dialog"
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted transition hover:bg-canvas hover:text-ink"
          onClick={onClose}
          type="button"
        >
          <X className="h-4 w-4" />
        </button>
      </header>
      <div className="flex min-h-0 flex-1 overflow-y-auto p-3 sm:p-5">
        <div
          className="m-auto w-full max-w-lg rounded-lg border border-line bg-paper p-4 shadow-soft sm:p-5"
          ref={contentRef}
        >
          {children}
        </div>
      </div>
      {footer ? (
        <footer className="shrink-0 border-t border-line bg-paper/95 px-4 py-3 sm:px-6">
          <div className="mx-auto w-full max-w-lg">{footer}</div>
        </footer>
      ) : null}
    </div>,
    document.body
  );
}
