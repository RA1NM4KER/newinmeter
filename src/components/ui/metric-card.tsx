"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";
import { Skeleton } from "./skeleton";
import type { MetricCardProps } from "./types";

export function MetricCardSkeleton() {
  return (
    <div className="rounded-lg border border-line bg-paper p-4">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="mt-3 h-7 w-16" />
      <Skeleton className="mt-2 h-3 w-32 max-w-full" />
    </div>
  );
}

type PopoverRect = { top: number; left: number; width: number };

const toneStyles = {
  neutral: "",
  good: "",
  watch: "",
  danger: ""
} as const;

const valueToneStyles = {
  neutral: "",
  good: "text-accent",
  watch: "text-amber-700 dark:text-amber-400",
  danger: "text-red-700 dark:text-red-400"
} as const;

const comparisonToneStyles = {
  neutral: "text-muted",
  good: "text-accent",
  watch: "text-amber-700 dark:text-amber-400",
  danger: "text-red-700 dark:text-red-400"
} as const;

export function MetricCard({ label, value, detail, description, tone = "neutral", comparison }: MetricCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [popoverRect, setPopoverRect] = useState<PopoverRect | null>(null);
  const containerRef = useRef<HTMLElement | null>(null);

  const toggle = () => setIsExpanded((previous) => !previous);

  // Rendered through a portal (below), positioned from the card's own
  // on-screen rect, rather than `position: absolute` inside the card.
  // The mobile card rail scrolls with overflow-x-auto, and CSS forces
  // overflow-y to clip too whenever overflow-x isn't "visible" on the
  // same element -- no z-index escapes that. A portal isn't a descendant
  // of the clipping container at all, so it floats freely on mobile the
  // same way it always did on desktop's non-scrolling grid layout.
  useLayoutEffect(() => {
    if (!isExpanded) {
      setPopoverRect(null);
      return;
    }

    const updateRect = () => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect) {
        setPopoverRect({ top: rect.bottom + 8, left: rect.left, width: rect.width });
      }
    };

    updateRect();
    window.addEventListener("resize", updateRect);

    return () => {
      window.removeEventListener("resize", updateRect);
    };
  }, [isExpanded]);

  useEffect(() => {
    if (!isExpanded) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsExpanded(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsExpanded(false);
      }
    };

    // Capture phase: the card rail's own horizontal scroll doesn't bubble
    // to window, so this is the only way to hear it (and any other
    // scrollable ancestor) and close rather than leave a stale-positioned
    // popover floating over the wrong card.
    const handleScroll = () => setIsExpanded(false);

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("scroll", handleScroll, true);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [isExpanded]);

  const card = (
    <section
      aria-expanded={description ? isExpanded : undefined}
      className={`relative min-w-0 rounded-lg border border-line bg-paper p-4 text-left ${
        description ? "cursor-pointer" : ""
      } ${toneStyles[tone]}`}
      onClick={description ? toggle : undefined}
      onKeyDown={
        description
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                toggle();
              }
            }
          : undefined
      }
      ref={containerRef}
      role={description ? "button" : undefined}
      tabIndex={description ? 0 : undefined}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted">{label}</p>
        <div className="flex shrink-0 items-center gap-2">
          {comparison ? (
            <p className={`text-xs font-medium ${comparisonToneStyles[comparison.tone]}`}>{comparison.text}</p>
          ) : null}
          {description ? (
            <ChevronDown
              aria-hidden="true"
              className={`h-3.5 w-3.5 text-muted/60 transition-transform ${isExpanded ? "rotate-180" : ""}`}
            />
          ) : null}
        </div>
      </div>
      <div className="mt-3">
        <p className={`break-words text-xl font-semibold tracking-tight sm:text-2xl ${valueToneStyles[tone]}`}>
          {value}
        </p>
      </div>
      {detail ? <p className="mt-2 break-words text-xs text-muted">{detail}</p> : null}
    </section>
  );

  if (isExpanded && description && popoverRect) {
    return (
      <>
        {card}
        {createPortal(
          <div
            className="fixed z-[999] rounded-lg border border-line bg-paper p-3 text-xs text-muted shadow-soft"
            style={{ top: popoverRect.top, left: popoverRect.left, width: popoverRect.width }}
          >
            {description}
          </div>,
          document.body
        )}
      </>
    );
  }

  return card;
}
