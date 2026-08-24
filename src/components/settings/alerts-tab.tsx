"use client";

import { SettingsGroup } from "@/components/ui/settings";
import { formatCurrency, formatKwh, formatTariff } from "@/lib/format";
import { DEFAULT_THRESHOLDS, FRESH_DATA_ALERT_TYPES, type AlertType } from "@/lib/newinmeter/alert-types";
import type { AlertInsights, AlertRule } from "@/lib/newinmeter/alerts";
import { AlertRuleRow } from "./alert-rule-row";
import { DeviceNotificationStatus } from "./device-notification-status";

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
  // One bounded read backing every row's secondary insight line (runway
  // days, projected month spend, current tariff, band position, anomaly
  // learning progress) -- see getAlertInsights. Null when unavailable; every
  // row degrades to having no helper text rather than an error.
  insights: AlertInsights | null;
  // A rounded, history-derived starting point for the monthly_budget input,
  // shown only the first time (initialThreshold is null) -- never persisted
  // until the user actually saves. Null when there isn't enough history yet.
  suggestedMonthlyBudget: number | null;
  // Whether this connection has a known tariff structure (see
  // tariff-profiles.ts) -- tariff_band_approaching is only ever offered
  // when this is true; hidden entirely otherwise rather than shown
  // disabled, per the product's "cleanliness wins" instruction.
  hasTariffProfile: boolean;
  onEnabledChange: (type: AlertType, enabled: boolean) => void;
  onAutoSyncEnabledChange: (enabled: boolean) => void;
};

function ruleFor(rules: AlertRule[], type: AlertType) {
  return rules.find((rule) => rule.type === type);
}

function pluralDays(days: number): string {
  return `${days} ${days === 1 ? "day" : "days"}`;
}

// Grouped exactly per the product spec: Balance & spending / Usage & tariff
// / More / System -- not a flat list, and not nine equally loud cards. Each
// group is its own SettingsGroup, same visual language as the rest of
// Settings. Threshold input only ever appears once a row is enabled; every
// row is otherwise a compact title + description + toggle.
export function AlertsTab({
  rules,
  enabledByType,
  autoSyncEnabled,
  isDemo,
  latestBalance,
  insights,
  suggestedMonthlyBudget,
  hasTariffProfile,
  onEnabledChange,
  onAutoSyncEnabledChange
}: AlertsTabProps) {
  const lowBalance = ruleFor(rules, "low_balance");
  const balanceRunway = ruleFor(rules, "balance_runway");
  const dailySpend = ruleFor(rules, "daily_spend");
  const monthlyBudget = ruleFor(rules, "monthly_budget");
  const dailyKwh = ruleFor(rules, "daily_kwh");
  const tariffChanged = ruleFor(rules, "tariff_changed");
  const tariffBandApproaching = ruleFor(rules, "tariff_band_approaching");
  const usageAnomaly = ruleFor(rules, "usage_anomaly");

  // Gated on enabledByType (the live, optimistically-updated client state),
  // never on the rule's own `.enabled` from the server-fetched `rules`
  // snapshot -- that snapshot is only as fresh as the last full page load,
  // so gating on it left every one of these helper lines silently missing
  // for the first render after a user actually flips a toggle on, only
  // appearing after a reload. enabledByType is what AlertRuleRow itself is
  // driven by, so this is the same source of truth the toggle's own visual
  // state already uses.
  const runwayHelperText = !enabledByType.balance_runway
    ? undefined
    : insights?.runway.hasEnoughHistory && insights.runway.estimatedDaysRemaining !== null
      ? `At your recent pace, your balance may last about ${pluralDays(Math.round(insights.runway.estimatedDaysRemaining))}.`
      : "Needs a few more days of usage history.";

  const budgetHelperText = !enabledByType.monthly_budget
    ? undefined
    : insights?.budget.hasEnoughHistory && insights.budget.projectedSpend !== null
      ? `You're on track to spend about ${formatCurrency(insights.budget.projectedSpend)} this month.`
      : "Needs a few more days of usage history.";

  const tariffChangedHelperText =
    enabledByType.tariff_changed && insights?.tariff.currentTariff
      ? `Your current rate is ${formatTariff(insights.tariff.currentTariff)}.`
      : undefined;

  const bandHelperText = !enabledByType.tariff_band_approaching
    ? undefined
    : insights?.band.nextBandKwh !== null && insights?.band.nextBandKwh !== undefined
      ? `You've used ${formatKwh(insights.band.monthKwh)} this month. Next band starts at ${formatKwh(insights.band.nextBandKwh)}.`
      : "You're already in the highest tariff band this month.";

  const anomalyHelperText = !enabledByType.usage_anomaly
    ? undefined
    : insights?.anomaly.hasEnoughHistory
      ? undefined
      : `Learning your usual usage patterns (${insights?.anomaly.learningDaysSoFar ?? 0} of ${insights?.anomaly.minLearningDays ?? 14} days).`;

  return (
    <div className="flex flex-col gap-6">
      <DeviceNotificationStatus />

      <SettingsGroup label="Balance & spending">
        <AlertRuleRow
          type="low_balance"
          title="Low balance"
          description="Notify me when my balance drops below this amount."
          unit="currency"
          defaultThreshold={DEFAULT_THRESHOLDS.low_balance ?? null}
          initialThreshold={lowBalance?.threshold ?? null}
          enabled={enabledByType.low_balance ?? false}
          needsAutoSync={FRESH_DATA_ALERT_TYPES.includes("low_balance")}
          autoSyncEnabled={autoSyncEnabled}
          isDemo={isDemo}
          helperText={latestBalance !== null ? `Your balance is currently ${formatCurrency(latestBalance)}.` : undefined}
          onEnabledChange={onEnabledChange}
          onAutoSyncEnabledChange={onAutoSyncEnabledChange}
        />
        <AlertRuleRow
          type="balance_runway"
          title="Running out soon"
          description="Get a heads-up before your balance may run out."
          unit="days"
          defaultThreshold={DEFAULT_THRESHOLDS.balance_runway ?? null}
          initialThreshold={balanceRunway?.threshold ?? null}
          enabled={enabledByType.balance_runway ?? false}
          needsAutoSync={FRESH_DATA_ALERT_TYPES.includes("balance_runway")}
          autoSyncEnabled={autoSyncEnabled}
          isDemo={isDemo}
          helperText={runwayHelperText}
          onEnabledChange={onEnabledChange}
          onAutoSyncEnabledChange={onAutoSyncEnabledChange}
        />
        <AlertRuleRow
          type="daily_spend"
          title="Daily spending"
          description="Notify me when today's spend exceeds this amount."
          unit="currency"
          defaultThreshold={DEFAULT_THRESHOLDS.daily_spend ?? null}
          initialThreshold={dailySpend?.threshold ?? null}
          enabled={enabledByType.daily_spend ?? false}
          needsAutoSync={FRESH_DATA_ALERT_TYPES.includes("daily_spend")}
          autoSyncEnabled={autoSyncEnabled}
          isDemo={isDemo}
          onEnabledChange={onEnabledChange}
          onAutoSyncEnabledChange={onAutoSyncEnabledChange}
        />
        <AlertRuleRow
          type="monthly_budget"
          title="Monthly budget"
          description="Get notified if your spending pace is heading over budget."
          unit="currency"
          defaultThreshold={suggestedMonthlyBudget}
          initialThreshold={monthlyBudget?.threshold ?? null}
          enabled={enabledByType.monthly_budget ?? false}
          needsAutoSync={FRESH_DATA_ALERT_TYPES.includes("monthly_budget")}
          autoSyncEnabled={autoSyncEnabled}
          isDemo={isDemo}
          helperText={budgetHelperText}
          onEnabledChange={onEnabledChange}
          onAutoSyncEnabledChange={onAutoSyncEnabledChange}
        />
      </SettingsGroup>

      <SettingsGroup label="Usage & tariff">
        <AlertRuleRow
          type="tariff_changed"
          title="Tariff changes"
          description="Notify me when my electricity rate changes."
          unit={null}
          defaultThreshold={null}
          initialThreshold={null}
          enabled={enabledByType.tariff_changed ?? false}
          needsAutoSync={FRESH_DATA_ALERT_TYPES.includes("tariff_changed")}
          autoSyncEnabled={autoSyncEnabled}
          isDemo={isDemo}
          helperText={tariffChangedHelperText}
          onEnabledChange={onEnabledChange}
          onAutoSyncEnabledChange={onAutoSyncEnabledChange}
        />
        {hasTariffProfile ? (
          <AlertRuleRow
            type="tariff_band_approaching"
            title="Approaching a higher tariff band"
            description="Notify me before this month's usage crosses into a pricier band."
            unit={null}
            defaultThreshold={null}
            initialThreshold={null}
            enabled={enabledByType.tariff_band_approaching ?? false}
            needsAutoSync={FRESH_DATA_ALERT_TYPES.includes("tariff_band_approaching")}
            autoSyncEnabled={autoSyncEnabled}
            isDemo={isDemo}
            helperText={bandHelperText}
            onEnabledChange={onEnabledChange}
            onAutoSyncEnabledChange={onAutoSyncEnabledChange}
          />
        ) : null}
        <AlertRuleRow
          type="usage_anomaly"
          title="Activity prompts"
          description="Ask me what happened when electricity use looks unusual."
          unit={null}
          defaultThreshold={null}
          initialThreshold={null}
          enabled={enabledByType.usage_anomaly ?? false}
          needsAutoSync={FRESH_DATA_ALERT_TYPES.includes("usage_anomaly")}
          autoSyncEnabled={autoSyncEnabled}
          isDemo={isDemo}
          helperText={anomalyHelperText}
          onEnabledChange={onEnabledChange}
          onAutoSyncEnabledChange={onAutoSyncEnabledChange}
        />
      </SettingsGroup>

      <SettingsGroup label="More">
        <AlertRuleRow
          type="daily_kwh"
          title="Daily electricity"
          description="Notify me when today's electricity usage exceeds this amount."
          unit="kwh"
          defaultThreshold={DEFAULT_THRESHOLDS.daily_kwh ?? null}
          initialThreshold={dailyKwh?.threshold ?? null}
          enabled={enabledByType.daily_kwh ?? false}
          needsAutoSync={FRESH_DATA_ALERT_TYPES.includes("daily_kwh")}
          autoSyncEnabled={autoSyncEnabled}
          isDemo={isDemo}
          onEnabledChange={onEnabledChange}
          onAutoSyncEnabledChange={onAutoSyncEnabledChange}
        />
      </SettingsGroup>

      <SettingsGroup label="System">
        <AlertRuleRow
          type="data_delayed"
          title="Delayed data"
          description="Notify me if NewinMeter hasn't received fresh LiveMopay data as expected."
          unit={null}
          defaultThreshold={null}
          initialThreshold={null}
          enabled={enabledByType.data_delayed ?? false}
          needsAutoSync={false}
          autoSyncEnabled={autoSyncEnabled}
          isDemo={isDemo}
          onEnabledChange={onEnabledChange}
          onAutoSyncEnabledChange={onAutoSyncEnabledChange}
        />
      </SettingsGroup>
    </div>
  );
}
