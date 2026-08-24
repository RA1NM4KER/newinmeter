"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Loader2, RefreshCw } from "lucide-react";
import { triggerIconToneClass, triggerToneClass, type ControlTone } from "./control-tone";

export type SyncButtonProps = {
  iconOnly?: boolean;
  className?: string;
  tone?: ControlTone;
  onSuccess?: () => void | Promise<void>;
  showNudge?: boolean;
  disabled?: boolean;
  disabledReason?: string;
};

const syncModes = [
  { value: "incremental", label: "Sync new rows", subtitle: "Fetch only what's changed since your last sync" },
  { value: "full", label: "Full resync", subtitle: "Refetch your entire LiveMopay history from scratch" }
] as const;

type PopoverPosition = {
  left: number;
  top: number;
  width: number;
};

const popoverWidth = 256;
const popoverMargin = 12;

export function SyncButton({
  iconOnly = false,
  className,
  tone = "light",
  onSuccess,
  showNudge = false,
  disabled = false,
  disabledReason
}: SyncButtonProps) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [position, setPosition] = useState<PopoverPosition>({
    left: popoverMargin,
    top: popoverMargin,
    width: popoverWidth
  });
  const containerRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen || !containerRef.current) {
      return;
    }

    const updatePosition = () => {
      if (!containerRef.current) {
        return;
      }

      const rect = containerRef.current.getBoundingClientRect();
      const matchesMobile = window.matchMedia("(max-width: 639px)").matches;
      const width = matchesMobile ? rect.width : popoverWidth;
      const desiredLeft = matchesMobile ? rect.left : rect.left + rect.width / 2 - width / 2;
      const left = Math.min(window.innerWidth - width - popoverMargin, Math.max(popoverMargin, desiredLeft));

      // Anchor below the button by default, measuring the popover's actual
      // height (below) to decide whether it fits -- flip above when it
      // doesn't (e.g. this trigger sitting low in Settings' Data & Sync
      // card, where "below" often runs past the viewport/card edge).
      const measuredHeight = popoverRef.current?.getBoundingClientRect().height ?? 0;
      const fitsBelow = rect.bottom + measuredHeight + popoverMargin <= window.innerHeight;
      const top = fitsBelow ? rect.bottom + 8 : Math.max(popoverMargin, rect.top - measuredHeight - 8);

      setPosition({ left, top, width });
    };

    // Runs once to get an initial (assume-below) position so the popover
    // paints and has a real height to measure, then again on the next frame
    // once that height is known -- corrects the flip in the same open
    // gesture rather than visibly jumping after the fact.
    updatePosition();
    const raf = requestAnimationFrame(updatePosition);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown, true);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
    };
  }, [isOpen]);

  async function handleSync(mode: (typeof syncModes)[number]["value"]) {
    if (mode === "full" && !window.confirm("Run a full LiveMopay resync? This will refetch the full range.")) {
      return;
    }

    setIsLoading(true);
    setIsOpen(false);

    try {
      const response = await fetch("/api/sync", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ mode })
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null);

        if (body?.reauthRequired) {
          router.push("/connect");
          return;
        }

        throw new Error(body?.message || "Sync failed.");
      }

      await onSuccess?.();
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div
      className="relative"
      onKeyDown={(event) => {
        if (event.key === "Escape") setIsOpen(false);
      }}
      ref={containerRef}
    >
      <button
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-busy={isLoading}
        title={disabled ? disabledReason : undefined}
        className={`relative inline-flex h-9 items-center gap-2 rounded-md border text-sm outline-none transition disabled:cursor-not-allowed disabled:opacity-60 ${triggerToneClass(tone)} ${
          iconOnly ? "px-2" : "px-3"
        } ${className ?? ""}`}
        disabled={isLoading || disabled}
        onClick={() => setIsOpen((prev) => !prev)}
        type="button"
      >
        {showNudge && !isLoading ? (
          <span className="absolute -right-0.5 -top-0.5 flex h-2.5 w-2.5" aria-hidden="true">
            <span className="absolute inline-flex h-full w-full motion-safe:animate-ping rounded-full bg-amber-400 opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-500" />
          </span>
        ) : null}
        {isLoading ? (
          <Loader2 aria-hidden="true" className={`h-4 w-4 animate-spin ${triggerIconToneClass(tone)}`} />
        ) : (
          <RefreshCw aria-hidden="true" className={`h-4 w-4 ${triggerIconToneClass(tone)}`} />
        )}
        {iconOnly ? <span className="sr-only">Sync</span> : <span>Sync</span>}
        {showNudge && !isLoading ? <span className="sr-only"> (new data may be available)</span> : null}
        <ChevronDown
          aria-hidden="true"
          className={`ml-auto h-4 w-4 transition ${triggerIconToneClass(tone)} ${isOpen ? "rotate-180" : ""}`}
        />
      </button>

      {isOpen ? (
        <div
          className="fixed z-40 rounded-md border border-line bg-paper p-1 shadow-soft"
          ref={popoverRef}
          role="listbox"
          aria-label="Sync options"
          style={{ left: position.left, top: position.top, width: position.width }}
        >
          {syncModes.map(({ value, label, subtitle }) => (
            <button
              className="flex w-full flex-col items-start gap-0.5 rounded px-2 py-2 text-left transition hover:bg-canvas disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isLoading}
              key={value}
              onClick={() => void handleSync(value)}
              type="button"
            >
              <span className="inline-flex items-center gap-1.5 text-sm text-ink">
                {label}
                {showNudge && value === "incremental" ? (
                  <span className="inline-flex h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden="true" />
                ) : null}
              </span>
              <span className="text-xs text-muted">{subtitle}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
