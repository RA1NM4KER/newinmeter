"use client";

import { useState } from "react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Toggle } from "@/components/ui/settings";
import type { AlertType } from "@/lib/newinmeter/alert-types";
import {
  ensurePushNotificationsEnabled,
  getPushPermissionState,
  hasDismissedPushPrompt,
  markPushPromptDismissed,
  type PushEnableResult
} from "@/lib/push-client";

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

// Copy for every non-error outcome of turning an alert ON, once the save
// itself has actually succeeded -- the alert is on in every one of these
// cases, this is purely "how will you find out". Centralised here (one
// small map, not four near-identical template strings scattered through the
// handlers below).
function pushOutcomeMessage(title: string, outcome: PushEnableResult["status"] | "dismissed"): string | null {
  switch (outcome) {
    case "granted":
      return null;
    case "denied":
      return `${title} alert is on, but notifications are blocked on this device. You'll still see alerts in NewinMeter.`;
    case "dismissed":
      return `${title} alert is on. You'll still see alerts in NewinMeter, but this device won't notify you when the app is closed.`;
    case "unsupported":
      return `${title} alert is on. Push notifications aren't available on this device, but you'll still see alerts in NewinMeter.`;
    case "subscription_failed":
      return "Your alert is on, but this device couldn't be registered for push notifications. You can try again from General.";
  }
}

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
  // Distinct from `error` -- these are all "the alert saved fine, here's a
  // heads up about how you'll find out about it", not failures. Separate
  // state (and styling) so a denied/dismissed/unsupported push outcome
  // never reads like something went wrong.
  const [info, setInfo] = useState<string | null>(null);
  const [confirmingAutoSync, setConfirmingAutoSync] = useState(false);
  // Holds the alsoEnableAutoSync decision between the auto-sync confirm
  // step and the (possible) push-permission step that follows it -- the two
  // dialogs are sequential, never simultaneous, so one pending value covers
  // it.
  const [pendingAlsoEnableAutoSync, setPendingAlsoEnableAutoSync] = useState(false);
  const [confirmingPush, setConfirmingPush] = useState(false);

  const needsAutoSync = unit !== null;

  // Returns whether the save actually succeeded -- callers use this to
  // decide whether a push-outcome message is even meaningful (never show
  // "you'll still see alerts in NewinMeter" over an alert that isn't
  // actually on).
  async function save(nextEnabled: boolean, nextThreshold: number, alsoEnableAutoSync: boolean): Promise<boolean> {
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
        return false;
      }

      if (typeof body.rule.threshold === "number") {
        setThreshold(body.rule.threshold);
      }
      onEnabledChange(type, body.rule.enabled);
      if (typeof body.autoSyncEnabled === "boolean" && body.autoSyncEnabled !== autoSyncEnabled) {
        onAutoSyncEnabledChange(body.autoSyncEnabled, body.nextSyncAt ?? null);
      }
      return true;
    } catch {
      setError("Couldn't save this alert.");
      onEnabledChange(type, previousEnabled);
      return false;
    } finally {
      setBusy(false);
    }
  }

  // The push-permission step of enabling an alert. Three ways in:
  //  - permission already "granted" -> silently (re)confirm a subscription
  //    exists (covers a device that granted permission once but lost its
  //    subscription, e.g. cleared site data) -- no dialog, this is Case 1.
  //  - permission "denied" -> never prompt again, just note it.
  //  - permission "default" and not previously dismissed on this device ->
  //    hand off to the explainer dialog instead of saving yet (see
  //    proceedToEnable).
  //  - permission "default" but already dismissed once, or the platform
  //    doesn't support push at all -> save without any push attempt.
  async function saveWithPushOutcome(alsoEnableAutoSync: boolean, outcome: PushEnableResult["status"] | "dismissed") {
    const saved = await save(true, threshold, alsoEnableAutoSync);
    setInfo(saved ? pushOutcomeMessage(title, outcome) : null);
  }

  async function proceedToEnable(alsoEnableAutoSync: boolean) {
    const permissionState = getPushPermissionState();

    if (permissionState === "granted") {
      const result = await ensurePushNotificationsEnabled();
      await saveWithPushOutcome(alsoEnableAutoSync, result.status);
      return;
    }

    if (permissionState === "default" && !hasDismissedPushPrompt()) {
      setPendingAlsoEnableAutoSync(alsoEnableAutoSync);
      setConfirmingPush(true);
      return;
    }

    // "denied", "unsupported", or "default"-but-already-dismissed: no
    // browser prompt, no dialog -- just save and (for denied/unsupported)
    // note it once.
    const outcome = permissionState === "default" ? "dismissed" : permissionState;
    await saveWithPushOutcome(alsoEnableAutoSync, outcome);
  }

  function handleToggle(next: boolean) {
    if (busy) return;
    setInfo(null);

    if (!next) {
      void save(false, threshold, false);
      return;
    }

    if (needsAutoSync && !autoSyncEnabled) {
      setConfirmingAutoSync(true);
      return;
    }

    void proceedToEnable(false);
  }

  function handleConfirmAutoSync() {
    setConfirmingAutoSync(false);
    void proceedToEnable(true);
  }

  async function handlePushEnable() {
    setConfirmingPush(false);
    setBusy(true);
    try {
      const result = await ensurePushNotificationsEnabled();
      await saveWithPushOutcome(pendingAlsoEnableAutoSync, result.status);
    } finally {
      setBusy(false);
    }
  }

  function handlePushNotNow() {
    markPushPromptDismissed();
    setConfirmingPush(false);
    void saveWithPushOutcome(pendingAlsoEnableAutoSync, "dismissed");
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

      {info ? <p className="mt-2 text-[0.8125rem] text-muted">{info}</p> : null}

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

      <ConfirmDialog
        open={confirmingPush}
        title={`Get ${title.toLowerCase()} notifications`}
        message="NewinMeter needs permission to notify you on this device when your alert is triggered."
        confirmLabel="Enable notifications"
        cancelLabel="Not now"
        confirmVariant="primary"
        busy={busy}
        onConfirm={() => void handlePushEnable()}
        onCancel={handlePushNotNow}
      />
    </div>
  );
}
