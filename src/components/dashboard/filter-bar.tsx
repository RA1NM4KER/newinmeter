"use client";

import { DatePicker } from "@/components/ui/date-picker";
import { DropdownSelect } from "@/components/ui/dropdown-select";
import { quickRangeOptions, type QuickRangePreset } from "@/lib/filters";
import type { QuickRange } from "@/lib/types";
import type { FilterBarProps, IsoDateInputProps } from "./types";

function IsoDateInput({
  label,
  value,
  onChange,
  buttonClassName,
  loading,
  fullWidth,
  max,
  min
}: IsoDateInputProps & {
  buttonClassName?: string;
  loading?: boolean;
  fullWidth?: boolean;
  max?: string;
  min?: string;
}) {
  return (
    <label className={`relative flex min-w-0 ${fullWidth ? "w-full" : ""}`}>
      <span className="pointer-events-none absolute left-3 top-0 z-10 -translate-y-1/2 bg-brandTeal px-1 text-[0.6rem] font-medium uppercase tracking-[0.18em] text-white/80">
        {label}
      </span>
      <DatePicker
        label={label}
        loading={loading}
        max={max}
        min={min}
        onChange={onChange}
        value={value}
        buttonClassName={buttonClassName}
        tone="dark"
        fullWidth={fullWidth}
      />
    </label>
  );
}

type RangeDropdownProps = {
  quickRange: QuickRange;
  onQuickRange: (range: QuickRangePreset) => void;
  loading?: boolean;
};

function RangeDropdown({ quickRange, onQuickRange, loading, className }: RangeDropdownProps & { className?: string }) {
  return (
    <DropdownSelect
      ariaLabel="Date range"
      value={quickRange}
      options={quickRangeOptions}
      fallbackLabel="Custom range"
      onChange={(value) => onQuickRange(value as QuickRangePreset)}
      loading={loading}
      className={className ?? "w-36"}
      tone="dark"
    />
  );
}

function FilterBarContent({
  from,
  to,
  quickRange,
  onDateChange,
  onQuickRange,
  loading = false,
  leftControls,
  extraControls,
  rightControls,
  rightControlsExpanded = false,
  splitMobileRow = false,
  fullBleed = false,
  sticky = false
}: FilterBarProps) {
  // fullBleed stretches the bar's own bg out to fill the gap above it and
  // out to the edges of its container (main's px-3/sm:px-6/lg:px-8), via a
  // negative margin matched by an equal inner padding increase on the sides.
  // Vertical padding is symmetric (py-6) so the controls sit centered in
  // the taller bar rather than pinned toward the bottom. Coupled to
  // app-shell.tsx's <main> padding values by necessity (any full-bleed
  // breakout has to know what it's breaking out of); only used by the
  // dashboard's sticky header, not the plain-card usage in the data table.
  //
  // `sticky` must live on this SAME element, not a wrapping parent -- a
  // parent with no padding/border lets this element's negative top margin
  // collapse into it, and position:sticky's "static position" reference
  // gets computed inconsistently when margin collapse is involved (visible
  // as the bar scrolling a bit before it actually catches and sticks).
  // One element carrying both rules sidesteps the collapse entirely.
  const containerClassName = fullBleed
    ? `-mx-3 -mt-6 bg-brandTeal px-6 py-6 sm:-mx-6 sm:px-9 lg:-mx-8 lg:px-11 ${sticky ? "lg:sticky lg:top-0 lg:z-20" : ""}`
    : "rounded-lg border border-line bg-brandTeal px-3 py-3";

  return (
    <div className={containerClassName}>
      {/* Mobile */}
      <div className="flex flex-col gap-2 sm:hidden">
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1 [&_button]:w-full">{leftControls}</div>
          <div className="min-w-0 flex-1">
            <RangeDropdown quickRange={quickRange} onQuickRange={onQuickRange} loading={loading} className="w-full" />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <IsoDateInput
              label="From"
              value={from}
              onChange={(value) => onDateChange(value, to && value > to ? value : to)}
              buttonClassName="h-8 px-2 gap-1.5 text-xs"
              loading={loading}
              fullWidth
            />
          </div>
          <div className="min-w-0 flex-1">
            <IsoDateInput
              label="To"
              value={to}
              onChange={(value) => onDateChange(from, value)}
              min={from}
              buttonClassName="h-8 px-2 gap-1.5 text-xs"
              loading={loading}
              fullWidth
            />
          </div>
        </div>
        {(extraControls ?? rightControls) ? (
          <div className="flex items-center gap-2">
            {splitMobileRow ? (
              <div className="min-w-0 flex-1 [&_button]:w-full [&_summary]:w-full">{extraControls}</div>
            ) : (
              extraControls
            )}
            {rightControls ? (
              // splitMobileRow grows both cells to an even 50/50 split
              // (Activities: extraControls is just TagFilter, rightControls
              // just Export -- both fixed content, forced to share the row
              // evenly). Everywhere else, rightControls keeps its original
              // min-w-0 flex-1 so multi-control blocks (Data's search input
              // + export button) can still shrink/wrap internally.
              <div className={splitMobileRow ? "min-w-0 flex-1 [&_button]:w-full" : "min-w-0 flex-1"}>
                {rightControls}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Desktop */}
      <div className="hidden sm:flex sm:flex-wrap sm:items-center sm:gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {leftControls}
          <RangeDropdown quickRange={quickRange} onQuickRange={onQuickRange} loading={loading} />
          <IsoDateInput
            label="From"
            value={from}
            onChange={(value) => onDateChange(value, to && value > to ? value : to)}
            buttonClassName="min-w-[8.25rem]"
            loading={loading}
          />
          <IsoDateInput
            label="To"
            value={to}
            onChange={(value) => onDateChange(from, value)}
            min={from}
            buttonClassName="min-w-[8.25rem]"
            loading={loading}
          />
          {extraControls}
        </div>
        {rightControls ? (
          <div className={rightControlsExpanded ? "ml-auto w-full max-w-[19.5rem]" : "ml-auto"}>{rightControls}</div>
        ) : null}
      </div>
    </div>
  );
}

export const FilterBar = (props: FilterBarProps) => <FilterBarContent {...props} />;
