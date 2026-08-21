"use client";

import { useRef } from "react";
import type { LiveWindow } from "@/lib/live/meter-types";

const WINDOWS: Array<{ value: LiveWindow; label: string }> = [
  { value: "15m", label: "15m" },
  { value: "30m", label: "30m" },
  { value: "1h", label: "1h" },
  { value: "6h", label: "6h" }
];

type WindowSelectorProps = {
  value: LiveWindow;
  onChange: (value: LiveWindow) => void;
};

// Segmented control (radiogroup) rather than the dashboard's date FilterBar --
// this is rolling telemetry, not a historical range. Keyboard accessible:
// arrows move between options, matching the radiogroup pattern.
export function WindowSelector({ value, onChange }: WindowSelectorProps) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  function handleKeyDown(event: React.KeyboardEvent, index: number) {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") {
      return;
    }
    event.preventDefault();
    const delta = event.key === "ArrowRight" ? 1 : -1;
    const next = (index + delta + WINDOWS.length) % WINDOWS.length;
    onChange(WINDOWS[next].value);
    refs.current[next]?.focus();
  }

  return (
    <div
      role="radiogroup"
      aria-label="Live graph time window"
      className="grid w-full grid-cols-4 gap-1 rounded-lg border border-line bg-canvas p-1 sm:inline-flex sm:w-auto sm:items-center"
    >
      {WINDOWS.map((option, index) => {
        const isActive = option.value === value;
        return (
          <button
            key={option.value}
            ref={(node) => {
              refs.current[index] = node;
            }}
            type="button"
            role="radio"
            aria-checked={isActive}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={`min-w-[3rem] rounded-md px-3 py-1.5 text-sm font-medium tabular-nums transition ${
              isActive ? "bg-paper text-ink shadow-sm" : "text-muted hover:text-ink"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
