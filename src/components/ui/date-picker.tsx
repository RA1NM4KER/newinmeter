"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { DayPicker, type ClassNames } from "react-day-picker";
import { triggerIconToneClass, triggerToneClass, type ControlTone } from "./control-tone";

const calendarClassNames = {
  root: "text-sm text-ink",
  months: "flex",
  month: "space-y-3",
  month_caption: "flex h-9 items-center justify-center px-9",
  caption_label: "text-sm font-semibold text-ink",
  nav: "absolute inset-x-2 top-2 flex items-center justify-between",
  button_previous:
    "inline-flex h-7 w-7 items-center justify-center rounded-md text-muted transition hover:bg-canvas hover:text-ink disabled:opacity-30",
  button_next:
    "inline-flex h-7 w-7 items-center justify-center rounded-md text-muted transition hover:bg-canvas hover:text-ink disabled:opacity-30",
  chevron: "h-4 w-4 fill-current",
  month_grid: "w-full border-collapse",
  weekdays: "grid grid-cols-7",
  weekday: "flex h-7 items-center justify-center text-[11px] font-medium uppercase tracking-[0.08em] text-muted",
  week: "grid grid-cols-7",
  day: "flex h-9 w-9 items-center justify-center",
  day_button:
    "flex h-8 w-8 items-center justify-center rounded-md text-sm text-ink transition hover:bg-canvas focus:outline-none focus:ring-2 focus:ring-accent/40",
  selected: "[&>button]:bg-ink [&>button]:text-paper [&>button]:hover:bg-ink",
  today: "[&>button]:border [&>button]:border-accent/50",
  outside: "[&>button]:text-muted/45",
  disabled: "[&>button]:cursor-not-allowed [&>button]:text-muted/30 [&>button]:hover:bg-transparent"
} satisfies Partial<ClassNames>;

export type DatePickerProps = {
  buttonClassName?: string;
  closeOnSelect?: boolean;
  label?: string;
  loading?: boolean;
  max?: string;
  min?: string;
  onChange(date: string): void;
  selectableDates?: Set<string>;
  value: string;
  tone?: ControlTone;
  fullWidth?: boolean;
};

type PopoverPosition = {
  left: number;
  top: number;
};

const popoverWidth = 278;
const popoverHeight = 318;
const popoverMargin = 12;

export function parseIsoDate(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function formatIsoDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function DatePicker({
  buttonClassName,
  closeOnSelect = true,
  label,
  loading = false,
  max,
  min,
  onChange,
  selectableDates,
  value,
  tone = "light",
  fullWidth = false
}: DatePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState<PopoverPosition>({ left: popoverMargin, top: popoverMargin });
  const containerRef = useRef<HTMLDivElement>(null);
  const selectedDate = useMemo(() => (value ? parseIsoDate(value) : undefined), [value]);
  const [month, setMonth] = useState(selectedDate);
  const minDate = min ? parseIsoDate(min) : undefined;
  const maxDate = max ? parseIsoDate(max) : undefined;

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !containerRef.current) {
      return;
    }

    const updatePosition = () => {
      if (!containerRef.current) {
        return;
      }

      const rect = containerRef.current.getBoundingClientRect();
      const centeredLeft = rect.left + rect.width / 2 - popoverWidth / 2;
      const left = Math.min(window.innerWidth - popoverWidth - popoverMargin, Math.max(popoverMargin, centeredLeft));
      const belowTop = rect.bottom + 8;
      const aboveTop = rect.top - popoverHeight - 8;
      const top =
        belowTop + popoverHeight <= window.innerHeight - popoverMargin ? belowTop : Math.max(popoverMargin, aboveTop);

      setPosition({ left, top });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [isOpen]);

  useEffect(() => {
    if (selectedDate) {
      setMonth(selectedDate);
    }
  }, [selectedDate]);

  return (
    <div className={`relative ${fullWidth ? "w-full" : "w-auto"}`} ref={containerRef}>
      <button
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        aria-label={label}
        className={`flex h-9 ${fullWidth ? "w-full" : "w-auto"} items-center justify-between gap-3 whitespace-nowrap rounded-md border px-3 text-sm outline-none transition ${triggerToneClass(tone)}${buttonClassName ? ` ${buttonClassName}` : ""}`}
        onClick={() => {
          setIsOpen((current) => !current);
        }}
        type="button"
      >
        <span>{value}</span>
        {loading || !value ? (
          <Loader2 aria-hidden="true" className={`h-4 w-4 shrink-0 animate-spin ${triggerIconToneClass(tone)}`} />
        ) : (
          <svg
            aria-hidden="true"
            className={`h-4 w-4 ${triggerIconToneClass(tone)}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            viewBox="0 0 24 24"
          >
            <path d="M8 2v4" />
            <path d="M16 2v4" />
            <rect height="18" rx="2" width="18" x="3" y="4" />
            <path d="M3 10h18" />
          </svg>
        )}
      </button>
      {isOpen ? (
        <div
          className="fixed z-[80] w-max overflow-auto rounded-lg border border-line bg-paper p-3 shadow-soft"
          role="dialog"
          style={{ left: position.left, top: position.top }}
        >
          <DayPicker
            captionLayout="label"
            classNames={calendarClassNames}
            defaultMonth={selectedDate}
            disabled={(date) => {
              const isoDate = formatIsoDate(date);
              if ((min && isoDate < min) || (max && isoDate > max)) {
                return true;
              }
              return selectableDates ? !selectableDates.has(isoDate) : false;
            }}
            endMonth={maxDate}
            fixedWeeks
            mode="single"
            month={month}
            onMonthChange={setMonth}
            onSelect={(date) => {
              if (date) {
                onChange(formatIsoDate(date));
                setMonth(date);
                if (closeOnSelect) {
                  setIsOpen(false);
                }
              }
            }}
            selected={selectedDate}
            showOutsideDays
            startMonth={minDate}
          />
        </div>
      ) : null}
    </div>
  );
}
