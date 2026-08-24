"use client";

import { useState } from "react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Toggle } from "@/components/ui/settings";
import type { AlertType } from "@/lib/newinmeter/alert-types";
import { hasDismissedDeviceNotifications, markDeviceNotificationsDismissed } from "@/lib/push-client";
import { useDeviceNotifications } from "@/components/layout/push-notification-provider";

type AlertRuleRowProps = {
  type: AlertType;
  title: string;
  description: string;
  // "currency" | "kwh" | "days" for the five threshold alerts, null for the
  // four with no user-configurable number (data_delayed, tariff_changed,
  // tariff_band_approaching, usage_anomaly).
  unit: "currency" | "kwh" | "days" | null;
  defaultThreshold: number | null;
  initialThreshold: number | null;
  // Optional reference point shown under the threshold input (e.g. "Your
  // balance is currently R143.41.") -- so setting a number isn't a guess.
  // Also doubles as the "learning"/"insufficient history" subtle status
  // line for the no-threshold v2 types -- same slot, same styling, always
  // at most one line.
  helperText?: string;
  // Whether turning this ON requires fresh LiveMopay data (see
  // FRESH_DATA_ALERT_TYPES) -- explicit rather than derived from `unit`,
  // since several no-threshold types (tariff_changed,
  // tariff_band_approaching, usage_anomaly) still need fresh data despite
  // having nothing for the user to configure; data_delayed is the only
  // type with unit === null that does NOT need it.
  needsAutoSync: boolean;
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

type PushOutcome = "on" | "denied" | "unsupported" | "subscription_failed" | "dismissed";

// Copy for every non-error outcome of turning an alert ON, once the save
// itself has actually succeeded -- the alert is on in every one of these
// cases, this is purely "how will you find out". Centralised here (one
// small map, not four near-identical template strings scattered through the
// handlers below).
function pushOutcomeMessage(title: string, outcome: PushOutcome): string | null {
  switch (outcome) {
    case "on":
      return null;
    case "denied":
      return `${title} is on, but notifications are blocked on this device. You'll still see alerts in NewinMeter.`;
    case "dismissed":
      return `${title} is on. You'll see alerts in NewinMeter, but this device won't send push notifications.`;
    case "unsupported":
      return `${title} is on. Push notifications aren't available on this device, but you'll still see alerts in NewinMeter.`;
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
  needsAutoSync,
  enabled,
  autoSyncEnabled,
  isDemo,
  onEnabledChange,
  onAutoSyncEnabledChange
}: AlertRuleRowProps) {
  const { browserPermission, subscriptionActive, enableDeviceNotifications } = useDeviceNotifications();
  // null (not 0) when there's genuinely no starting value (e.g.
  // monthly_budget with no history-derived suggestion yet) -- see
  // handleToggle/handleThresholdBlur's own comments for why that distinction
  // matters: 0 would auto-save as an invalid threshold the instant the row
  // is turned on, before the user has typed anything.
  const [threshold, setThreshold] = useState<number | null>(initialThreshold ?? defaultThreshold ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Distinct from `error` -- these are all "the alert saved fine, here's a
  // heads up about how you'll find out about it", not failures. Separate
  // state (and styling) so a denied/dismissed/unsupported push outcome
  // never reads like something went wrong.
  const [info, setInfo] = useState<string | null>(null);
  const [confirmingAutoSync, setConfirmingAutoSync] = useState(false);
  // Holds the alsoEnableAutoSync decision between the auto-sync confirm
  // step and the (possible) device-notifications step that follows it --
  // the two dialogs are sequential, never simultaneous, so one pending
  // value covers it.
  const [pendingAlsoEnableAutoSync, setPendingAlsoEnableAutoSync] = useState(false);
  const [confirmingPush, setConfirmingPush] = useState(false);
  // Carries an auto-sync confirmation across the deferred-threshold gap
  // below: if the user already confirmed "turn on automatic updates too"
  // before a usable threshold existed, that confirmation must still apply
  // once they actually provide one and blur, not get silently dropped.
  const [deferredAlsoEnableAutoSync, setDeferredAlsoEnableAutoSync] = useState(false);

  // Returns whether the save actually succeeded -- callers use this to
  // decide whether a push-outcome message is even meaningful (never show
  // "you'll still see alerts in NewinMeter" over an alert that isn't
  // actually on).
  async function save(nextEnabled: boolean, nextThreshold: number | null, alsoEnableAutoSync: boolean): Promise<boolean> {
    // No usable starting value yet (monthly_budget with no history-derived
    // suggestion is the only case today -- every other threshold type
    // always has a real DEFAULT_THRESHOLDS entry). Reveal the input and
    // wait for the user to actually type a value rather than auto-saving
    // an invalid 0, which the server would reject with a confusing error
    // the instant the toggle is touched.
    if (nextEnabled && unit !== null && nextThreshold === null) {
      onEnabledChange(type, true);
      setDeferredAlsoEnableAutoSync(alsoEnableAutoSync);
      return false;
    }

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

  async function saveWithPushOutcome(alsoEnableAutoSync: boolean, outcome: PushOutcome) {
    const saved = await save(true, threshold, alsoEnableAutoSync);
    setInfo(saved ? pushOutcomeMessage(title, outcome) : null);
  }

  // The device-notifications step of enabling an alert. Checks
  // subscriptionActive -- the real "is this device currently receiving
  // NewinMeter push" state -- never browserPermission alone. That was the
  // bug: permission can be "granted" while the user explicitly turned
  // General's Notifications off, and the old flow silently re-subscribed
  // on the next alert enable because it only ever looked at permission.
  async function proceedToEnable(alsoEnableAutoSync: boolean) {
    if (subscriptionActive) {
      // Device push already on -- enable the alert, nothing else to ask.
      await saveWithPushOutcome(alsoEnableAutoSync, "on");
      return;
    }

    if (browserPermission === "denied") {
      // Permission is blocked at the browser level -- offering a "turn on
      // notifications" choice here would be a button that can't work.
      // Never re-prompts; just saves and explains.
      await saveWithPushOutcome(alsoEnableAutoSync, "denied");
      return;
    }

    if (browserPermission === "unsupported") {
      await saveWithPushOutcome(alsoEnableAutoSync, "unsupported");
      return;
    }

    if (hasDismissedDeviceNotifications()) {
      // Already asked once on this device and the user chose to keep
      // notifications off -- don't ask again on every alert toggle. Cleared
      // automatically the moment this device's push actually turns on
      // (via either General or this same dialog elsewhere), so turning
      // General off again later is treated as a fresh decision.
      await saveWithPushOutcome(alsoEnableAutoSync, "dismissed");
      return;
    }

    // Permission is "granted" (but this device is unsubscribed) or
    // "default" -- either way, device push is off and asking is worthwhile.
    setPendingAlsoEnableAutoSync(alsoEnableAutoSync);
    setConfirmingPush(true);
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

  async function handleTurnOnNotifications() {
    setConfirmingPush(false);
    setBusy(true);
    try {
      // May call Notification.requestPermission() internally (only when
      // permission is still "default") -- fine here, this is a direct
      // response to the user's own "Turn on notifications" click.
      const result = await enableDeviceNotifications();
      await saveWithPushOutcome(pendingAlsoEnableAutoSync, result.status === "granted" ? "on" : result.status);
    } finally {
      setBusy(false);
    }
  }

  function handleKeepNotificationsOff() {
    markDeviceNotificationsDismissed();
    setConfirmingPush(false);
    void saveWithPushOutcome(pendingAlsoEnableAutoSync, "dismissed");
  }

  function handleThresholdBlur() {
    if (!enabled || busy || threshold === null) return;
    void save(true, threshold, deferredAlsoEnableAutoSync);
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
            inputMode={unit === "days" ? "numeric" : "decimal"}
            min={unit === "days" ? 1 : 0}
            max={unit === "days" ? 30 : undefined}
            step={unit === "days" ? 1 : undefined}
            onBlur={handleThresholdBlur}
            onChange={(event) =>
              setThreshold(unit === "days" ? Math.round(Number(event.target.value)) : Number(event.target.value))
            }
            placeholder={threshold === null && unit === "currency" ? "e.g. 1500" : undefined}
            type="number"
            value={threshold ?? ""}
          />
          {unit === "kwh" ? <span className="text-sm text-muted">kWh</span> : null}
          {unit === "days" ? <span className="text-sm text-muted">days</span> : null}
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
        title="Turn on notifications?"
        message={`${title} alerts are active in NewinMeter, but notifications are off on this device. Turn them on so NewinMeter can notify you when it happens?`}
        confirmLabel="Turn on notifications"
        cancelLabel="Keep notifications off"
        confirmVariant="primary"
        busy={busy}
        onConfirm={() => void handleTurnOnNotifications()}
        onCancel={handleKeepNotificationsOff}
      />
    </div>
  );
}
