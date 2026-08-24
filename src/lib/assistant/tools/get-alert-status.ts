import { formatCurrency, formatKwh } from "@/lib/format";
import {
  ALERT_TYPES,
  DEFAULT_THRESHOLDS,
  FRESH_DATA_ALERT_TYPES,
  getAlertInsights,
  getAlertRulesForUser,
  getLatestBalanceForUser,
  type AlertRule,
  type AlertType
} from "@/lib/newinmeter/alerts";
import { THRESHOLD_ALERT_TYPES } from "@/lib/newinmeter/alert-types";
import { getConnectionForUser } from "@/lib/newinmeter/connection";
import { currentLocalDateString } from "@/lib/newinmeter/schedule";
import type { AssistantTool } from "../types";
import { EmptySchema } from "./schemas";

export const getAlertStatusTool: AssistantTool = {
  definition: {
    type: "function",
    name: "get_alert_status",
    description:
      "Get the status of every alert type for this account: enabled/disabled, configured threshold, and the current relevant metric (balance, today's spend/kWh, estimated runway days, projected monthly spend, current tariff band). Use for questions like 'what alerts do I have on', 'am I close to my threshold', or 'how close am I to the next tariff band'.",
    parameters: EmptySchema,
    strict: true
  },
  handler: async (_args, getContext) => {
    const context = await getContext();
    const [rules, insights, balance, connection] = await Promise.all([
      getAlertRulesForUser(context.userId),
      getAlertInsights(context.userId),
      getLatestBalanceForUser(context.userId),
      getConnectionForUser(context.userId)
    ]);

    const ruleByType = new Map<AlertType, AlertRule>(rules.map((rule) => [rule.type, rule]));
    const today = currentLocalDateString(new Date());
    const todayRow = context.dailyRows.find((row) => row.periodDate === today);

    const statuses = ALERT_TYPES.map((type) => {
      const rule = ruleByType.get(type);
      const enabled = rule?.enabled ?? false;
      const threshold = rule?.threshold ?? null;
      const hasThreshold = THRESHOLD_ALERT_TYPES.includes(type);
      const needsAutoSync = FRESH_DATA_ALERT_TYPES.includes(type);

      let currentValue: number | null = null;
      let currentValueDisplay: string | null = null;
      let extra: Record<string, unknown> = {};

      switch (type) {
        case "low_balance":
          currentValue = balance;
          currentValueDisplay = balance !== null ? formatCurrency(balance) : null;
          break;
        case "daily_spend":
          currentValue = todayRow?.totalSpend ?? null;
          currentValueDisplay = currentValue !== null ? formatCurrency(currentValue) : null;
          break;
        case "daily_kwh":
          currentValue = todayRow?.energyKwh ?? null;
          currentValueDisplay = currentValue !== null ? formatKwh(currentValue) : null;
          break;
        case "balance_runway":
          currentValue = insights?.runway.estimatedDaysRemaining ?? null;
          currentValueDisplay = currentValue !== null ? `${Math.round(currentValue)} days` : null;
          extra = { hasEnoughHistory: insights?.runway.hasEnoughHistory ?? false };
          break;
        case "monthly_budget":
          currentValue = insights?.budget.projectedSpend ?? null;
          currentValueDisplay = currentValue !== null ? formatCurrency(currentValue) : null;
          extra = { hasEnoughHistory: insights?.budget.hasEnoughHistory ?? false };
          break;
        case "tariff_changed":
          currentValue = insights?.tariff.currentTariff ?? null;
          break;
        case "tariff_band_approaching":
          currentValue = insights?.band.monthKwh ?? null;
          currentValueDisplay = currentValue !== null ? formatKwh(currentValue) : null;
          extra = {
            profile: insights?.band.profile ?? null,
            nextBandKwh: insights?.band.nextBandKwh ?? null,
            warningDistanceKwh: insights?.band.warningDistanceKwh ?? null
          };
          break;
        case "usage_anomaly":
          extra = {
            learningDaysSoFar: insights?.anomaly.learningDaysSoFar ?? 0,
            minLearningDays: insights?.anomaly.minLearningDays ?? 0,
            hasEnoughHistory: insights?.anomaly.hasEnoughHistory ?? false
          };
          break;
        case "data_delayed":
          break;
      }

      return {
        type,
        enabled,
        hasThreshold,
        threshold,
        defaultThreshold: DEFAULT_THRESHOLDS[type] ?? null,
        needsAutoSync,
        currentValue,
        currentValueDisplay,
        ...extra
      };
    });

    return {
      scope: context.scope,
      today,
      autoSyncEnabled: connection?.autoSyncEnabled ?? false,
      lastSyncedAt: connection?.lastSyncedAt ?? null,
      dedupSemantics: {
        low_balance:
          "Fires once when balance first crosses below the threshold, then stays quiet until it rises back above and crosses again.",
        balance_runway:
          "Fires once when estimated days-remaining first drops to the threshold or below; only clears once it rises back above threshold+1 day (hysteresis), to avoid flapping right at the line.",
        daily_spend:
          "At most once per SAST calendar day. Suppressed (no push, but state still advances) if monthly_budget also fired the same sync.",
        daily_kwh: "At most once per SAST calendar day.",
        monthly_budget: "At most once per calendar month.",
        tariff_changed:
          "Fires once per real observed tariff change. The first sync after enabling only establishes a silent baseline -- it never reports history as if it just happened.",
        tariff_band_approaching: "At most once per band threshold per calendar month.",
        usage_anomaly:
          "At most once per SAST calendar day. Suppressed entirely if an existing Activity already covers most of the anomalous window.",
        data_delayed:
          "One open event after data goes stale for 13+ hours; a later successful sync resolves it automatically.",
        correlated_suppression:
          "When balance_runway and low_balance would both notify from the same sync, only balance_runway (the more informative one) actually pushes/shows; low_balance's own event is still recorded but hidden. Same relationship between monthly_budget and daily_spend."
      },
      alerts: statuses
    };
  }
};
