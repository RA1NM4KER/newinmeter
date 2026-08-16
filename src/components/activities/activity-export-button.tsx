"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, FileDown } from "lucide-react";
import { apiEndpoints } from "@/lib/endpoints";

// Short labels so they fit a panel sized to the (narrow) "Export" trigger.
const formats = [
  { value: "csv", label: "CSV" },
  { value: "xlsx", label: "XLSX" }
] as const;

export function ActivityExportButton({ params }: { params: URLSearchParams }) {
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  function exportUrl(format: (typeof formats)[number]["value"]) {
    const exportParams = new URLSearchParams(params);
    exportParams.set("format", format);
    return `${apiEndpoints.activityExport}?${exportParams.toString()}`;
  }

  // Fixed positioning sized to the trigger width (right-aligned), so the menu
  // matches the trigger button and isn't clipped by an ancestor's overflow.
  useEffect(() => {
    if (!isOpen || !containerRef.current) {
      return;
    }
    const update = () => {
      if (!containerRef.current) {
        return;
      }
      const rect = containerRef.current.getBoundingClientRect();
      // Exactly the trigger width, aligned under it, so the menu matches the
      // button that opened it (same as the range selector).
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
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") setIsOpen(false);
      }}
    >
      <button
        aria-expanded={isOpen}
        aria-haspopup="menu"
        className="inline-flex h-9 items-center justify-between gap-2 rounded-md border border-white/15 bg-white/10 px-3 text-sm text-white outline-none transition hover:bg-white/15"
        onClick={() => setIsOpen((current) => !current)}
        type="button"
      >
        <span className="inline-flex min-w-0 items-center gap-2">
          <FileDown aria-hidden="true" className="h-4 w-4 shrink-0 text-white/70" />
          <span className="shrink-0">Export</span>
        </span>
        <ChevronDown
          aria-hidden="true"
          className={`h-4 w-4 shrink-0 text-white/70 transition ${isOpen ? "rotate-180" : ""}`}
        />
      </button>

      {isOpen ? (
        <div
          aria-label="Activity export format"
          className="fixed z-[80] rounded-md border border-line bg-paper p-1 shadow-soft"
          role="menu"
          style={{ left: position.left, top: position.top, width: position.width }}
        >
          {formats.map((format) => (
            <a
              className="flex w-full items-center rounded px-3 py-2 text-left text-sm text-muted transition hover:bg-canvas hover:text-ink"
              download
              href={exportUrl(format.value)}
              key={format.value}
              onClick={() => setIsOpen(false)}
              role="menuitem"
            >
              {format.label}
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
}
