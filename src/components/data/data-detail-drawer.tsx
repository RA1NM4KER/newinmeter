"use client";

import { X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { getFocusable, resolveTrapFocusIndex } from "@/components/ui/focus-trap";
import { formatCurrency } from "@/lib/format";
import type { EnergyRow } from "@/lib/types";
import {
  amountClassFor,
  amountDisplayFor,
  balanceClassFor,
  dataDateTimeDisplayFor,
  meterEntryDisplayFor,
  tariffBandDisplayFor,
  tariffDisplayFor,
  transactionSummaryFor,
  usageDisplayFor
} from "./row-formatting";

const DRAWER_ANIM_MS = 220;

const chargeTypeLabel: Record<EnergyRow["chargeKind"], string> = {
  energy: "Energy charge",
  water: "Water charge",
  fixed: "Fixed charge",
  topup: "Top up",
  refund: "Refund"
};

function DetailRow({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line px-4 py-3 last:border-b-0">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="max-w-[65%] text-right text-sm font-medium text-ink">{children}</dd>
    </div>
  );
}

function DetailGroup({ children, label }: { children: ReactNode; label: string }) {
  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted">{label}</h3>
      <dl className="overflow-hidden rounded-lg border border-line">{children}</dl>
    </section>
  );
}

export function DataDetailDrawer({ onClose, row }: { onClose: () => void; row: EnergyRow }) {
  const [visible, setVisible] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);

  const requestClose = useCallback(() => {
    setVisible(false);
    window.setTimeout(onClose, DRAWER_ANIM_MS);
  }, [onClose]);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const raf = requestAnimationFrame(() => {
      setVisible(true);
      closeButtonRef.current?.focus();
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        requestClose();
        return;
      }

      if (event.key === "Tab" && panelRef.current) {
        const focusable = getFocusable(panelRef.current);
        const activeIndex = focusable.indexOf(document.activeElement as HTMLElement);
        const nextIndex = resolveTrapFocusIndex(focusable.length, activeIndex, event.shiftKey);
        if (nextIndex >= 0) {
          event.preventDefault();
          focusable[nextIndex]?.focus();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [requestClose]);

  const hasUsage = row.usageUnit !== null;
  const isCredit = row.chargeKind === "topup" || row.chargeKind === "refund";
  const meterEntry = meterEntryDisplayFor(row);

  return createPortal(
    <div
      aria-label={`Details for ${chargeTypeLabel[row.chargeKind]} at ${row.periodDateTime.replace("T", " ")}`}
      aria-modal="true"
      className="fixed inset-0 z-50"
      role="dialog"
    >
      <button
        aria-label="Close transaction details"
        className={`absolute inset-0 h-full w-full cursor-default bg-ink/10 backdrop-blur-md transition-opacity duration-200 motion-reduce:transition-none ${
          visible ? "opacity-100" : "opacity-0"
        }`}
        onClick={requestClose}
        tabIndex={-1}
        type="button"
      />

      <aside
        className={`absolute right-0 top-0 flex h-full w-[min(28rem,92vw)] flex-col border-l border-line bg-paper shadow-soft transition-transform duration-200 ease-out motion-reduce:transition-none ${
          visible ? "translate-x-0" : "translate-x-full"
        }`}
        ref={panelRef}
      >
        <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">Transaction details</p>
            <h2 className="mt-1 text-base font-semibold text-ink">{chargeTypeLabel[row.chargeKind]}</h2>
          </div>
          <button
            aria-label="Close transaction details"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-line bg-canvas text-muted transition hover:text-ink"
            onClick={requestClose}
            ref={closeButtonRef}
            type="button"
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-6 overflow-auto px-5 py-5">
          <div className="rounded-lg border border-accent/25 bg-accentSoft p-4">
            <p className="text-sm font-medium leading-6 text-ink">{transactionSummaryFor(row)}</p>
          </div>

          <DetailGroup label="Overview">
            <DetailRow label="Period">{dataDateTimeDisplayFor(row.periodDateTime)}</DetailRow>
            {meterEntry ? <DetailRow label="Meter entry">{meterEntry}</DetailRow> : null}
          </DetailGroup>

          {hasUsage ? (
            <DetailGroup label="Usage and pricing">
              <DetailRow label="Usage">{usageDisplayFor(row)}</DetailRow>
              <DetailRow label="Tariff">{tariffDisplayFor(row)}</DetailRow>
              <DetailRow label="Tariff band">{tariffBandDisplayFor(row.tariffBand)}</DetailRow>
            </DetailGroup>
          ) : null}

          <DetailGroup label="Transaction">
            <DetailRow label={isCredit ? "Amount credited" : "Amount"}>
              <span className={amountClassFor(row)}>{amountDisplayFor(row)}</span>
            </DetailRow>
            <DetailRow label="Balance afterward">
              <span className={balanceClassFor(row.balance)}>{formatCurrency(row.balance)}</span>
            </DetailRow>
            <DetailRow label="Captured">{dataDateTimeDisplayFor(row.captureDateTime)}</DetailRow>
          </DetailGroup>
        </div>
      </aside>
    </div>,
    document.body
  );
}
