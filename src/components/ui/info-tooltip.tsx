"use client";

import { Info } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { InfoTooltipProps } from "./types";

type PopoverRect = { top: number; left: number };

const POPOVER_WIDTH = 256;

export function InfoTooltip({ text, label = "More information" }: InfoTooltipProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [popoverRect, setPopoverRect] = useState<PopoverRect | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  // Portal-rendered rather than `position: absolute` inside the trigger, for
  // the same reason as MetricCard's description popover -- an ancestor with
  // overflow-x-auto (e.g. the mobile filter row) clips overflow-y too, and a
  // portal isn't a descendant of that clipping container at all.
  useLayoutEffect(() => {
    if (!isOpen) {
      setPopoverRect(null);
      return;
    }

    const updateRect = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) {
        return;
      }
      const left = Math.min(rect.left, window.innerWidth - POPOVER_WIDTH - 16);
      setPopoverRect({ top: rect.bottom + 8, left: Math.max(left, 16) });
    };

    updateRect();
    window.addEventListener("resize", updateRect);

    return () => {
      window.removeEventListener("resize", updateRect);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!buttonRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    const handleScroll = () => setIsOpen(false);

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("scroll", handleScroll, true);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [isOpen]);

  return (
    <>
      <button
        aria-expanded={isOpen}
        aria-label={label}
        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-muted transition hover:text-ink"
        onClick={() => setIsOpen((previous) => !previous)}
        ref={buttonRef}
        type="button"
      >
        <Info className="h-4 w-4" />
      </button>
      {isOpen && popoverRect
        ? createPortal(
            <div
              className="fixed z-[999] rounded-lg border border-line bg-paper p-3 text-xs text-muted shadow-soft"
              style={{ top: popoverRect.top, left: popoverRect.left, width: POPOVER_WIDTH }}
            >
              {text}
            </div>,
            document.body
          )
        : null}
    </>
  );
}
