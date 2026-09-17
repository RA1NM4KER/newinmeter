"use client";

import { DropdownSelect, type DropdownOption } from "./dropdown-select";

const directionOptions: DropdownOption[] = [
  { label: "Ascending", value: "asc" },
  { label: "Descending", value: "desc" }
];

export function MobileSortControls<TSortKey extends string>({
  options,
  sortKey,
  direction,
  onSortKeyChange,
  onDirectionChange
}: {
  options: DropdownOption[];
  sortKey: TSortKey;
  direction: "asc" | "desc";
  onSortKeyChange: (key: TSortKey) => void;
  onDirectionChange: (direction: "asc" | "desc") => void;
}) {
  return (
    <div className="flex shrink-0 items-end gap-2 border-b border-line bg-accentSoft px-4 py-3 sm:hidden">
      <label className="relative min-w-0 flex-1">
        <span className="pointer-events-none absolute left-3 top-0 z-10 -translate-y-1/2 bg-accentSoft px-1 text-[0.6rem] font-medium uppercase tracking-[0.18em] text-muted">
          Sort by
        </span>
        <DropdownSelect
          ariaLabel="Sort by"
          className="w-full"
          onChange={(value) => onSortKeyChange(value as TSortKey)}
          options={options}
          value={sortKey}
        />
      </label>
      <label className="relative min-w-0 flex-1">
        <span className="pointer-events-none absolute left-3 top-0 z-10 -translate-y-1/2 bg-accentSoft px-1 text-[0.6rem] font-medium uppercase tracking-[0.18em] text-muted">
          Order
        </span>
        <DropdownSelect
          ariaLabel="Sort order"
          className="w-full"
          onChange={(value) => onDirectionChange(value as "asc" | "desc")}
          options={directionOptions}
          value={direction}
        />
      </label>
    </div>
  );
}

export function MobileSortControlsSkeleton() {
  return (
    <div className="flex shrink-0 items-end gap-2 border-b border-line bg-accentSoft px-4 py-3 sm:hidden">
      {Array.from({ length: 2 }, (_, index) => (
        <div className="relative min-w-0 flex-1" key={index}>
          <div className="absolute left-3 top-0 z-10 h-2 w-10 -translate-y-1/2 animate-pulse rounded bg-accentSoft px-1">
            <div className="h-full w-full rounded bg-line/70" />
          </div>
          <div className="h-9 w-full animate-pulse rounded-md border border-line bg-line/70" />
        </div>
      ))}
    </div>
  );
}
