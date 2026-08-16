"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, FileDown } from "lucide-react";
import { triggerIconToneClass, triggerToneClass, type ControlTone } from "./control-tone";

export type ExportButtonProps = {
  from?: string;
  to?: string;
  chargeType?: string;
  search?: string;
  sort?: string;
  dir?: string;
  iconOnly?: boolean;
  className?: string;
  tone?: ControlTone;
};

// Short labels so the menu fits a panel sized to the trigger (matches the
// activities export).
const formats = [
  { value: "csv", label: "CSV" },
  { value: "xlsx", label: "XLSX" }
] as const;

export function ExportButton({
  from,
  to,
  chargeType,
  search,
  sort,
  dir,
  iconOnly = false,
  className,
  tone = "light"
}: ExportButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  function buildUrl(format: string) {
    const params = new URLSearchParams();
    params.set("format", format);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (chargeType && chargeType !== "all") params.set("chargeType", chargeType);
    if (search) params.set("search", search);
    if (sort) params.set("sort", sort);
    if (dir) params.set("dir", dir);
    return `/api/export?${params.toString()}`;
  }

  // Fixed positioning sized to the trigger width (same as the activities export
  // and the range selector), so the menu matches the button and isn't clipped.
  useEffect(() => {
    if (!isOpen || !containerRef.current) {
      return;
    }
    const update = () => {
      if (!containerRef.current) {
        return;
      }
      const rect = containerRef.current.getBoundingClientRect();
      setPosition({ left: rect.left, top: rect.bottom + 8, width: rect.width });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [isOpen]);

  return (
    <div
      className="relative"
      ref={containerRef}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setIsOpen(false);
        }
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") setIsOpen(false);
      }}
    >
      <button
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        className={`inline-flex h-9 items-center justify-between gap-2 rounded-md border text-sm outline-none transition disabled:cursor-not-allowed disabled:opacity-60 ${triggerToneClass(tone)} ${
          iconOnly ? "px-2" : "px-3"
        } ${className ?? ""}`}
        onClick={() => setIsOpen((prev) => !prev)}
        type="button"
      >
        <span className="inline-flex min-w-0 items-center gap-2">
          <FileDown aria-hidden="true" className={`h-4 w-4 shrink-0 ${triggerIconToneClass(tone)}`} />
          {iconOnly ? <span className="sr-only">Export</span> : <span className="shrink-0">Export</span>}
        </span>
        <ChevronDown
          aria-hidden="true"
          className={`h-4 w-4 shrink-0 transition ${triggerIconToneClass(tone)} ${isOpen ? "rotate-180" : ""}`}
        />
      </button>

      {isOpen ? (
        <div
          className="fixed z-[80] rounded-md border border-line bg-paper p-1 shadow-soft"
          role="listbox"
          aria-label="Export format"
          style={{ left: position.left, top: position.top, width: position.width }}
        >
          {formats.map(({ value, label }) => (
            <a
              className="flex w-full items-center rounded px-3 py-2 text-left text-sm text-muted transition hover:bg-canvas hover:text-ink"
              download
              href={buildUrl(value)}
              key={value}
              onClick={() => setIsOpen(false)}
            >
              {label}
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
}
