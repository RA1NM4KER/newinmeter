"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronDown, Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import { triggerIconToneClass, triggerToneClass, type ControlTone } from "./control-tone";

export type DropdownOption = {
  label: string;
  value: string;
  disabled?: boolean;
  icon?: ReactNode;
};

type DropdownSelectProps = {
  ariaLabel: string;
  value: string;
  options: DropdownOption[];
  onChange(value: string): void;
  fallbackLabel?: string;
  className?: string;
  menuPlacement?: "bottom" | "top";
  hideLabelOnMobile?: boolean;
  loading?: boolean;
  tone?: ControlTone;
};

type MenuPosition = {
  left: number;
  width: number;
  top?: number;
  bottom?: number;
};

export function DropdownSelect({
  ariaLabel,
  value,
  options,
  onChange,
  fallbackLabel,
  className = "w-36",
  menuPlacement = "bottom",
  hideLabelOnMobile = false,
  loading = false,
  tone = "light"
}: DropdownSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState<MenuPosition>({ left: 0, width: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const activeOptionRef = useRef<HTMLButtonElement>(null);
  const activeOption = options.find((option) => option.value === value);
  const activeLabel = activeOption?.label ?? fallbackLabel ?? value;
  const activeIcon = activeOption?.icon;
  const triggerLabelClassName = hideLabelOnMobile ? "sr-only sm:not-sr-only" : undefined;
  const layoutClassName = hideLabelOnMobile ? "justify-center gap-2 sm:justify-between sm:gap-0" : "justify-between";

  // Fixed positioning (computed from the trigger's real screen position)
  // instead of an absolute/relative menu, so this never gets clipped by an
  // ancestor's overflow-x-auto -- the same fix as SyncButton and DatePicker.
  useEffect(() => {
    if (!isOpen || !containerRef.current) {
      return;
    }

    const updatePosition = () => {
      if (!containerRef.current) {
        return;
      }

      const rect = containerRef.current.getBoundingClientRect();

      setPosition(
        menuPlacement === "top"
          ? { left: rect.left, width: rect.width, bottom: window.innerHeight - rect.top + 8 }
          : { left: rect.left, width: rect.width, top: rect.bottom + 8 }
      );
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [isOpen, menuPlacement]);

  useLayoutEffect(() => {
    const menu = menuRef.current;
    const active = activeOptionRef.current;
    if (!isOpen || !menu || !active) return;

    menu.scrollTop = Math.max(0, active.offsetTop - (menu.clientHeight - active.offsetHeight) / 2);
  }, [isOpen, value]);

  // onBlur alone (below) doesn't reliably close this on mobile Chrome: a tap
  // on a plain, non-focusable element outside the dropdown doesn't move
  // focus anywhere, so no blur ever fires. A document-level pointerdown
  // listener is the same fix already used by MetricCard/InfoTooltip/
  // BottomSheet/ManageDrawer elsewhere in this app -- kept alongside onBlur
  // rather than replacing it, since onBlur still covers keyboard-driven
  // focus moves (Tab) that a pointerdown listener wouldn't catch.
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [isOpen]);

  return (
    <div
      className="relative"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setIsOpen(false);
        }
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          setIsOpen(false);
        }
      }}
      ref={containerRef}
    >
      <button
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        className={`inline-flex h-9 items-center ${layoutClassName} rounded-md border px-3 text-sm outline-none transition ${triggerToneClass(tone)} ${className}`}
        onClick={() => setIsOpen((current) => !current)}
        type="button"
      >
        <span className="flex min-w-0 items-center gap-1.5 truncate">
          {activeIcon ? <span className="shrink-0">{activeIcon}</span> : null}
          <span className={triggerLabelClassName}>{activeLabel}</span>
        </span>
        {loading ? (
          <Loader2 aria-hidden="true" className={`h-4 w-4 shrink-0 animate-spin ${triggerIconToneClass(tone)}`} />
        ) : (
          <ChevronDown
            aria-hidden="true"
            className={`h-4 w-4 shrink-0 transition ${triggerIconToneClass(tone)} ${isOpen ? "rotate-180" : ""}`}
          />
        )}
      </button>
      {isOpen ? (
        <div
          className="fixed z-[80] max-h-[min(20rem,calc(100vh-2rem))] overflow-y-auto rounded-md border border-line bg-paper p-1 shadow-soft"
          role="listbox"
          aria-label={ariaLabel}
          ref={menuRef}
          style={{ left: position.left, width: position.width, top: position.top, bottom: position.bottom }}
        >
          {options.map((option) => {
            const isActive = option.value === value;

            return (
              <button
                aria-selected={isActive}
                className={`flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm transition ${
                  option.disabled
                    ? "cursor-not-allowed text-muted/60"
                    : isActive
                      ? "bg-canvas text-ink"
                      : "text-muted hover:bg-canvas hover:text-ink"
                } ${hideLabelOnMobile ? "justify-center gap-0 sm:justify-start sm:gap-2" : ""}`}
                disabled={option.disabled}
                key={option.value}
                onClick={() => {
                  if (option.disabled) {
                    return;
                  }

                  onChange(option.value);
                  setIsOpen(false);
                }}
                role="option"
                ref={isActive ? activeOptionRef : undefined}
                type="button"
              >
                {option.icon ? <span className="shrink-0">{option.icon}</span> : null}
                <span className={triggerLabelClassName}>{option.label}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
