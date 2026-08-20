"use client";

import { X, type LucideIcon } from "lucide-react";
import { useEffect, type ReactNode } from "react";

type FullscreenDialogProps = {
  isOpen: boolean;
  onClose(): void;
  eyebrow?: string;
  title: string;
  // Compact annotation shown inline, right after the title text (e.g. a unit
  // note like "incl. fixed"). For controls, use titleControls/headerAction.
  titleAdornment?: ReactNode;
  // Compact controls (e.g. zoom) that sit on the title row, left of the close
  // button, so a chart with no other controls stays a one-line header.
  titleControls?: ReactNode;
  headerAction?: ReactNode;
  children: ReactNode;
  bodyClassName?: string;
  panelClassName?: string;
  contentClassName?: string;
  closeButtonVariant?: "default" | "dark";
  closeLabel?: string;
  closeIcon?: LucideIcon;
  onEscape?: () => void;
};

function closeButtonClassName(variant: "default" | "dark") {
  return variant === "dark"
    ? "inline-flex h-9 w-9 items-center justify-center rounded-md bg-ink text-paper transition hover:opacity-90"
    : "inline-flex h-9 w-9 items-center justify-center rounded-md border border-line bg-paper text-ink transition hover:bg-canvas";
}

export function FullscreenDialog({
  isOpen,
  onClose,
  eyebrow,
  title,
  titleAdornment,
  titleControls,
  headerAction,
  children,
  bodyClassName = "min-h-0 flex-1 overflow-auto p-3 sm:p-5",
  panelClassName = "",
  contentClassName = "",
  closeButtonVariant = "default",
  closeLabel = "Close dialog",
  closeIcon: CloseIcon = X,
  onEscape
}: FullscreenDialogProps) {
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        (onEscape ?? onClose)();
      }
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose, onEscape]);

  if (!isOpen) {
    return null;
  }

  return (
    <div aria-modal="true" className="fullscreen-glass fixed z-50 flex flex-col" role="dialog">
      <div className="border-b border-line bg-paper/95 px-4 py-2.5 sm:px-6">
        {/* On sm+, everything shares one row (title pushed left via mr-auto,
            headerAction/titleControls/close bunched right) -- same trick the
            inline chart card headers use. Below sm, headerAction drops to its
            own full-width row so it can't push the close button off-screen. */}
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <div className="mr-auto min-w-0">
            {eyebrow ? <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted">{eyebrow}</p> : null}
            <div className={`${eyebrow ? "mt-0.5" : ""} flex min-w-0 items-baseline gap-2`}>
              <h2 className="truncate text-base font-semibold text-ink sm:text-lg">{title}</h2>
              {titleAdornment ? (
                <span className="shrink-0 text-xs font-normal text-muted">{titleAdornment}</span>
              ) : null}
            </div>
          </div>
          {headerAction ? (
            <div className="order-last flex w-full flex-wrap items-center gap-1.5 sm:order-none sm:w-auto">
              {headerAction}
            </div>
          ) : null}
          <div className="flex shrink-0 items-center gap-1.5">
            {titleControls}
            <button
              aria-label={closeLabel}
              className={closeButtonClassName(closeButtonVariant)}
              onClick={onClose}
              type="button"
            >
              <CloseIcon className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
      <div className={bodyClassName}>
        <div className={`mx-auto flex h-full flex-col ${panelClassName}`.trim()}>
          <div className={contentClassName}>{children}</div>
        </div>
      </div>
    </div>
  );
}
