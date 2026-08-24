import { formatCurrency, formatKwh } from "@/lib/format";
import {
  DEFAULT_THRESHOLDS,
  getAlertInsights,
  getAlertRulesForUser,
  getLatestBalanceForUser,
  getSuggestedMonthlyBudget,
  type AlertType
} from "@/lib/newinmeter/alerts";
import type { AssistantTool } from "../types";
import { EmptySchema } from "./schemas";

type Recommendation = {
  type: AlertType;
  reason: string;
  suggestedThreshold: number | null;
};

export const getAlertRecommendationsTool: AssistantTool = {
  definition: {
    type: "function",
    name: "get_alert_recommendations",
    description:
      "Get grounded alert recommendations for this account -- only alert types that aren't already enabled and have real supporting data (never every alert type by default), each with a suggested threshold and the concrete reason. Use for 'which alerts should I turn on' style questions.",
    parameters: EmptySchema,
    strict: true
  },
  handler: async (_args, getContext) => {
    const context = await getContext();
    const [rules, insights, balance, suggestedBudget] = await Promise.all([
      getAlertRulesForUser(context.userId),
      getAlertInsights(context.userId),
      getLatestBalanceForUser(context.userId),
      getSuggestedMonthlyBudget(context.userId)
    ]);

    const enabledTypes = new Set(rules.filter((rule) => rule.enabled).map((rule) => rule.type));
    const recommendations: Recommendation[] = [];

    if (!enabledTypes.has("low_balance") && balance !== null) {
      recommendations.push({
        type: "low_balance",
        reason: `Your current balance is ${formatCurrency(balance)}. A low-balance alert warns you before you run out.`,
        suggestedThreshold: DEFAULT_THRESHOLDS.low_balance ?? null
      });
    }

    if (!enabledTypes.has("balance_runway") && insights?.runway.hasEnoughHistory) {
      recommendations.push({
        type: "balance_runway",
        reason:
          "You have enough recent spending history to reliably estimate days remaining -- this alert is more predictive than a fixed balance threshold.",
        suggestedThreshold: DEFAULT_THRESHOLDS.balance_runway ?? null
      });
    }

    if (!enabledTypes.has("monthly_budget") && suggestedBudget !== null) {
      recommendations.push({
        type: "monthly_budget",
        reason: `Based on your recent spending, about ${formatCurrency(suggestedBudget)}/month is a reasonable budget to track against.`,
        suggestedThreshold: suggestedBudget
      });
    }

    if (!enabledTypes.has("daily_spend") && context.dailyRows.length > 0) {
      recommendations.push({
        type: "daily_spend",
        reason:
          "Get notified the moment a single day's spend crosses a threshold, useful for catching an unusually expensive day early.",
        suggestedThreshold: DEFAULT_THRESHOLDS.daily_spend ?? null
      });
    }

    if (!enabledTypes.has("daily_kwh") && context.dailyRows.length > 0) {
      recommendations.push({
        type: "daily_kwh",
        reason:
          "Get notified when a single day's electricity usage crosses a threshold, independent of tariff changes.",
        suggestedThreshold: DEFAULT_THRESHOLDS.daily_kwh ?? null
      });
    }

    if (!enabledTypes.has("usage_anomaly")) {
      recommendations.push({
        type: "usage_anomaly",
        reason: insights?.anomaly.hasEnoughHistory
          ? "Enough usage history has been learned to reliably flag unusual spikes against your own normal pattern."
          : `Still learning your usage pattern (${insights?.anomaly.learningDaysSoFar ?? 0}/${insights?.anomaly.minLearningDays ?? 14} days) -- worth turning on now so it's ready once learning finishes.`,
        suggestedThreshold: null
      });
    }

    if (!enabledTypes.has("tariff_band_approaching") && insights?.band.profile) {
      recommendations.push({
        type: "tariff_band_approaching",
        reason: `Your tariff has stepped bands. This alert warns before you cross into a more expensive one -- currently ${formatKwh(insights.band.monthKwh)} used this month.`,
        suggestedThreshold: null
      });
    }

    if (!enabledTypes.has("data_delayed")) {
      recommendations.push({
        type: "data_delayed",
        reason:
          "Get notified if your data stops syncing for an extended period, so a connection problem doesn't go unnoticed.",
        suggestedThreshold: null
      });
    }

    return {
      scope: context.scope,
      recommendations,
      metadata: { groundedOnly: true, reason: "Only alert types with real supporting data are recommended." }
    };
  }
};
