import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import type { SortHeaderButtonProps } from "./types";

export function SortHeaderButton({ label, shortLabel, active, direction, onClick }: SortHeaderButtonProps) {
  return (
    <button
      className="inline-flex items-center font-medium uppercase tracking-[0.16em] transition hover:text-ink"
      onClick={onClick}
      type="button"
      aria-label={`Sort by ${label}`}
    >
      {shortLabel ? (
        <>
          <span className="sm:hidden">{shortLabel}</span>
          <span className="hidden sm:inline">{label}</span>
        </>
      ) : (
        label
      )}
      {/* Same convention as the data table: a faint up/down icon marks a column
          as sortable; the active column shows its actual direction. */}
      {!active ? (
        <ArrowUpDown aria-hidden="true" className="ml-1 h-3.5 w-3.5 text-muted/55" />
      ) : direction === "asc" ? (
        <ArrowUp aria-hidden="true" className="ml-1 h-3.5 w-3.5 text-ink" />
      ) : (
        <ArrowDown aria-hidden="true" className="ml-1 h-3.5 w-3.5 text-ink" />
      )}
    </button>
  );
}
