"use client";

import { useState } from "react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Toggle } from "@/components/ui/settings";
import type { AlertType } from "@/lib/newinmeter/alert-types";

type AlertRuleRowProps = {
  type: AlertType;
  title: string;
  description: string;
  // "currency" | "kwh" for the three fresh-data alerts, null for
  // data_delayed (no user-configurable threshold at all).
  unit: "currency" | "kwh" | null;
  defaultThreshold: number | null;
  initialThreshold: number | null;
  // Optional reference point shown under the threshold input (e.g. "Your
  // balance is currently R143.41.") -- so setting a number isn't a guess.
  helperText?: string;
  // Controlled from the parent (SettingsPageClient) -- the single source of
  // truth for "is this alert on", since ConnectionCard's auto-sync-off flow
  // needs to be able to see and react to it (the warning list) without a
  // full page reload. Threshold stays local/uncontrolled below: nothing
  // outside this row ever changes it.
  enabled: boolean;
  autoSyncEnabled: boolean;
  isDemo: boolean;
  onEnabledChange: (type: AlertType, enabled: boolean) => void;
  // Fired when this row's own "also turn on automatic updates" confirmation
  // succeeds, so the Data & Sync tab (already mounted, not refetched) shows
  // the change -- including the freshly computed next scheduled update --
  // immediately too, no page reload.
  onAutoSyncEnabledChange: (enabled: boolean, nextSyncAt?: string | null) => void;
};

export function AlertRuleRow({
  type,
  title,
  description,
  unit,
  defaultThreshold,
  initialThreshold,
  helperText,
  enabled,
  autoSyncEnabled,
  isDemo,
  onEnabledChange,
  onAutoSyncEnabledChange
}: AlertRuleRowProps) {
  const [threshold, setThreshold] = useState(initialThreshold ?? defaultThreshold ?? 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingAutoSync, setConfirmingAutoSync] = useState(false);

  const needsAutoSync = unit !== null;

  async function save(nextEnabled: boolean, nextThreshold: number, alsoEnableAutoSync: boolean) {
    const previousEnabled = enabled;

    setBusy(true);
    setError(null);
    // Optimistic: flip the toggle immediately rather than waiting on the
    // round trip -- previously the switch only moved once the network call
    // resolved, which on a slow connection reads as "stuck"/unresponsive.
    // Reverted below if the save doesn't actually succeed. A no-op for the
    // threshold-blur caller (nextEnabled === enabled already there).
    onEnabledChange(type, nextEnabled);

    try {
      const response = await fetch(`/api/alerts/${type}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: nextEnabled,
          threshold: unit === null ? null : nextThreshold,
          alsoEnableAutoSync
        })
      });

      const body = await response.json().catch(() => null);

      // `body` can be null even when response.ok -- a truncated/aborted
      // response body (flaky connection) still resolves the fetch with a
      // 2xx status but fails to parse. Treat a missing rule the same as a
      // failed save rather than crashing on `body.rule.threshold` below,
      // which previously masked an actually-successful server-side write
      // behind a generic "Couldn't save this alert." with no toggle revert.
      if (!response.ok || !body?.rule) {
        setError(body?.message || "Couldn't save this alert.");
        onEnabledChange(type, previousEnabled);
        return;
      }

      if (typeof body.rule.threshold === "number") {
        setThreshold(body.rule.threshold);
      }
      onEnabledChange(type, body.rule.enabled);
      if (typeof body.autoSyncEnabled === "boolean" && body.autoSyncEnabled !== autoSyncEnabled) {
        onAutoSyncEnabledChange(body.autoSyncEnabled, body.nextSyncAt ?? null);
      }
    } catch {
      setError("Couldn't save this alert.");
      onEnabledChange(type, previousEnabled);
    } finally {
      setBusy(false);
    }
  }

  function handleToggle(next: boolean) {
    if (busy) return;

    if (next && needsAutoSync && !autoSyncEnabled) {
      setConfirmingAutoSync(true);
      return;
    }

    void save(next, threshold, false);
  }

  function handleConfirmAutoSync() {
    setConfirmingAutoSync(false);
    void save(true, threshold, true);
  }

  function handleThresholdBlur() {
    if (!enabled || busy) return;
    void save(true, threshold, false);
  }

  if (isDemo) {
    return (
      <div className="flex items-center gap-4 border-t border-line px-4 py-4 first:border-t-0 sm:px-5">
        <div className="min-w-0 flex-1">
          <p className="text-[0.9375rem] font-medium text-ink">{title}</p>
          <p className="mt-0.5 text-[0.8125rem] text-muted">Not available for the shared demo account.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="border-t border-line px-4 py-4 first:border-t-0 sm:px-5">
      <div className="flex items-center gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-[0.9375rem] font-medium text-ink">{title}</p>
          <p className="mt-0.5 text-[0.8125rem] leading-snug text-muted">{description}</p>
        </div>
        <Toggle checked={enabled} disabled={busy} onChange={handleToggle} label={title} />
      </div>

      {enabled && unit ? (
        <div className="mt-3 flex items-center gap-2">
          {unit === "currency" ? <span className="text-sm text-muted">R</span> : null}
          <input
            className="h-9 w-28 rounded-md border border-line bg-canvas px-3 text-sm text-ink outline-none transition focus:border-accent disabled:opacity-60"
            disabled={busy}
            inputMode="decimal"
            min={0}
            onBlur={handleThresholdBlur}
            onChange={(event) => setThreshold(Number(event.target.value))}
            type="number"
            value={threshold}
          />
          {unit === "kwh" ? <span className="text-sm text-muted">kWh</span> : null}
        </div>
      ) : null}

      {enabled && helperText ? <p className="mt-2 text-[0.8125rem] text-muted">{helperText}</p> : null}

      {error ? <p className="mt-2 text-[0.8125rem] text-red-600">{error}</p> : null}

      <ConfirmDialog
        open={confirmingAutoSync}
        title="Turn on automatic updates?"
        message={`"${title}" needs fresh LiveMopay data to work, so turning it on will also turn on automatic updates for your connection.`}
        confirmLabel="Turn both on"
        confirmVariant="primary"
        busy={busy}
        onConfirm={handleConfirmAutoSync}
        onCancel={() => setConfirmingAutoSync(false)}
      />
    </div>
  );
}
