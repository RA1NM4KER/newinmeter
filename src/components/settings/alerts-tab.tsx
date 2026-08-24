"use client";

import { BellOff } from "lucide-react";
import { SettingsGroup } from "@/components/ui/settings";
import { formatCurrency } from "@/lib/format";
import { useDeviceNotifications } from "@/components/layout/push-notification-provider";
import { DEFAULT_THRESHOLDS, type AlertType } from "@/lib/newinmeter/alert-types";
import type { AlertRule } from "@/lib/newinmeter/alerts";
import { AlertRuleRow } from "./alert-rule-row";

type AlertsTabProps = {
  rules: AlertRule[];
  enabledByType: Partial<Record<AlertType, boolean>>;
  autoSyncEnabled: boolean;
  isDemo: boolean;
  // Server-fetched, display-only -- lets the low_balance row show "Your
  // balance is currently RX" next to the threshold input instead of asking
  // for a number with no reference point. Null when unavailable (no
  // connection yet, fetch failed) -- row just omits the hint then.
  latestBalance: number | null;
  onEnabledChange: (type: AlertType, enabled: boolean) => void;
  onAutoSyncEnabledChange: (enabled: boolean) => void;
};

function ruleFor(rules: AlertRule[], type: AlertType) {
  return rules.find((rule) => rule.type === type);
}

// Grouped clearly (Balance / Spending / Electricity / System & Data) rather
// than one flat list -- each group is its own SettingsGroup, same visual
// language as the rest of Settings. Deliberately compact: one row per
// alert, threshold only shown once enabled, no history/monitoring surface.
export function AlertsTab({
  rules,
  enabledByType,
  autoSyncEnabled,
  isDemo,
  latestBalance,
  onEnabledChange,
  onAutoSyncEnabledChange
}: AlertsTabProps) {
  const lowBalance = ruleFor(rules, "low_balance");
  const dailySpend = ruleFor(rules, "daily_spend");
  const dailyKwh = ruleFor(rules, "daily_kwh");

  // Alert rules and device push are separate concepts: a rule can be
  // enabled with no way to deliver it outside the app -- including when
  // browser permission is "granted" but the user explicitly turned this
  // device's notifications off in General (subscriptionActive, not
  // browserPermission, is the correct read here; conflating the two was
  // the underlying bug this whole provider exists to fix). Read-only
  // awareness (no dialog triggered here -- that's AlertRuleRow's job, on
  // the actual enable action), just a light heads up. Only relevant once
  // something is actually enabled -- an unconfigured Alerts tab has
  // nothing to be delivered, so nothing to flag.
  const { subscriptionActive } = useDeviceNotifications();
  const hasAnyEnabled = Object.values(enabledByType).some(Boolean);

  return (
    <div className="flex flex-col gap-6">
      {hasAnyEnabled && !subscriptionActive ? (
        <div className="flex items-start gap-2.5 rounded-xl border border-line bg-canvas px-4 py-3 text-sm text-muted">
          <BellOff aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
          <p>Alerts are active, but this device isn&apos;t sending push notifications. Manage this in General.</p>
        </div>
      ) : null}

      <SettingsGroup label="Balance">
        <AlertRuleRow
          type="low_balance"
          title="Low balance"
          description="Notify me when my balance drops below this amount."
          unit="currency"
          defaultThreshold={DEFAULT_THRESHOLDS.low_balance}
          initialThreshold={lowBalance?.threshold ?? null}
          enabled={enabledByType.low_balance ?? false}
          autoSyncEnabled={autoSyncEnabled}
          isDemo={isDemo}
          helperText={latestBalance !== null ? `Your balance is currently ${formatCurrency(latestBalance)}.` : undefined}
          onEnabledChange={onEnabledChange}
          onAutoSyncEnabledChange={onAutoSyncEnabledChange}
        />
      </SettingsGroup>

      <SettingsGroup label="Spending">
        <AlertRuleRow
          type="daily_spend"
          title="Daily spending"
          description="Notify me when today's spend exceeds this amount."
          unit="currency"
          defaultThreshold={DEFAULT_THRESHOLDS.daily_spend}
          initialThreshold={dailySpend?.threshold ?? null}
          enabled={enabledByType.daily_spend ?? false}
          autoSyncEnabled={autoSyncEnabled}
          isDemo={isDemo}
          onEnabledChange={onEnabledChange}
          onAutoSyncEnabledChange={onAutoSyncEnabledChange}
        />
      </SettingsGroup>

      <SettingsGroup label="Electricity">
        <AlertRuleRow
          type="daily_kwh"
          title="Daily electricity"
          description="Notify me when today's electricity usage exceeds this amount."
          unit="kwh"
          defaultThreshold={DEFAULT_THRESHOLDS.daily_kwh}
          initialThreshold={dailyKwh?.threshold ?? null}
          enabled={enabledByType.daily_kwh ?? false}
          autoSyncEnabled={autoSyncEnabled}
          isDemo={isDemo}
          onEnabledChange={onEnabledChange}
          onAutoSyncEnabledChange={onAutoSyncEnabledChange}
        />
      </SettingsGroup>

      <SettingsGroup label="System & Data">
        <AlertRuleRow
          type="data_delayed"
          title="Delayed data"
          description="Notify me if NewinMeter hasn't received fresh LiveMopay data as expected."
          unit={null}
          defaultThreshold={null}
          initialThreshold={null}
          enabled={enabledByType.data_delayed ?? false}
          autoSyncEnabled={autoSyncEnabled}
          isDemo={isDemo}
          onEnabledChange={onEnabledChange}
          onAutoSyncEnabledChange={onAutoSyncEnabledChange}
        />
      </SettingsGroup>
    </div>
  );
}
