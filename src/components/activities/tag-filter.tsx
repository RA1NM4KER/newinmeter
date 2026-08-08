"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { displayActivityTag } from "@/lib/activity-utils";

export function TagFilter({
  tags,
  selected,
  onChange
}: {
  tags: string[];
  selected: string[];
  onChange(tags: string[]): void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  // Fixed positioning sized to the trigger's real width (same technique as
  // DropdownSelect), so the panel matches the trigger button and isn't clipped
  // by an ancestor's overflow.
  useEffect(() => {
    if (!isOpen || !containerRef.current) {
      return;
    }
    const update = () => {
      if (!containerRef.current) {
        return;
      }
      const rect = containerRef.current.getBoundingClientRect();
      // Exactly the trigger width, so the panel matches the button that opened
      // it (same as the range selector).
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
        type="button"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label="Filter by tags"
        className="inline-flex h-9 min-w-[8.5rem] items-center justify-between gap-2 whitespace-nowrap rounded-md border border-white/15 bg-white/10 px-3 text-sm text-white outline-none transition hover:bg-white/15"
        onClick={() => setIsOpen((current) => !current)}
      >
        <span className="truncate">
          {selected.length ? `${selected.length} tag${selected.length === 1 ? "" : "s"}` : "All tags"}
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-white/70 transition ${isOpen ? "rotate-180" : ""}`} />
      </button>

      {isOpen ? (
        <div
          role="listbox"
          aria-label="Tags"
          className="fixed z-[80] max-h-64 overflow-auto rounded-md border border-line bg-paper p-2 shadow-soft"
          style={{ left: position.left, top: position.top, width: position.width }}
        >
          {!tags.length ? (
            <p className="px-2 py-2 text-sm text-muted">No tags yet</p>
          ) : (
            tags.map((tag) => {
              const checked = selected.includes(tag);
              return (
                <label
                  className="flex cursor-pointer items-center gap-2 rounded px-2 py-2 text-sm text-muted hover:bg-canvas hover:text-ink"
                  key={tag}
                >
                  <input
                    checked={checked}
                    className="shrink-0 accent-[rgb(var(--color-accent))]"
                    onChange={() => onChange(checked ? selected.filter((item) => item !== tag) : [...selected, tag])}
                    type="checkbox"
                  />
                  <span className="min-w-0 break-words">{displayActivityTag(tag)}</span>
                </label>
              );
            })
          )}
          {selected.length ? (
            <button
              className="mt-1 w-full border-t border-line px-2 pt-2 text-left text-xs text-muted hover:text-ink"
              onClick={() => onChange([])}
              type="button"
            >
              Clear tags
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
