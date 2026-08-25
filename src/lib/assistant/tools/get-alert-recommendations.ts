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
  // How many real complete days this suggestion is grounded on -- only set
  // for the two types (daily_spend/daily_kwh) whose threshold is actually
  // derived from this account's own history rather than a flat default.
  basedOnCompleteDays?: number;
};

// Minimum real history before a percentile-based threshold is trustworthy
// enough to suggest at all -- below this, daily_spend/daily_kwh are simply
// not recommended rather than falling back to an ungrounded flat default.
const MIN_COMPLETE_DAYS_FOR_GROUNDING = 7;
const MAX_RECOMMENDATIONS = 4;

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

// Linear-interpolation percentile over an already-sorted ascending array --
// standard "R-7"/Excel-style method, good enough for a threshold suggestion
// (not a statistics product).
function percentile(sortedAscending: number[], p: number): number {
  if (sortedAscending.length === 0) return 0;
  if (sortedAscending.length === 1) return sortedAscending[0];
  const index = (p / 100) * (sortedAscending.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sortedAscending[lower];
  const weight = index - lower;
  return sortedAscending[lower] * (1 - weight) + sortedAscending[upper] * weight;
}

function distributionStats(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    median: round2(percentile(sorted, 50)),
    p75: round2(percentile(sorted, 75)),
    p80: round2(percentile(sorted, 80)),
    p90: round2(percentile(sorted, 90))
  };
}

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
    // (recommendation, priority) pairs -- priority only used to rank/cap
    // below, never sent to the model. Roughly: real financial risk first
    // (balance running out), then day-level budget guardrails, then
    // secondary/informational alerts.
    const ranked: Array<{ recommendation: Recommendation; priority: number }> = [];

    if (!enabledTypes.has("low_balance") && balance !== null) {
      ranked.push({
        priority: 100,
        recommendation: {
          type: "low_balance",
          reason: `Your current balance is ${formatCurrency(balance)}. A low-balance alert warns you before you run out -- it's simple, but fires at the same rand amount regardless of how fast you're spending. If you want a warning that adapts to your actual spending pace instead, balance_runway (below, when available) is the more predictive option.`,
          suggestedThreshold: DEFAULT_THRESHOLDS.low_balance ?? null
        }
      });
    }

    if (!enabledTypes.has("balance_runway") && insights?.runway.hasEnoughHistory) {
      ranked.push({
        priority: 95,
        recommendation: {
          type: "balance_runway",
          reason:
            "You have enough recent spending history to reliably estimate days remaining. Unlike a fixed low-balance threshold, this adapts to how fast you're actually spending -- it warns earlier if you're burning through balance quickly, and later if you're not, rather than firing at the same rand amount every time.",
          suggestedThreshold: DEFAULT_THRESHOLDS.balance_runway ?? null
        }
      });
    }

    if (!enabledTypes.has("monthly_budget") && suggestedBudget !== null) {
      ranked.push({
        priority: 80,
        recommendation: {
          type: "monthly_budget",
          reason: `Based on your recent spending, about ${formatCurrency(suggestedBudget)}/month is a reasonable budget to track against.`,
          suggestedThreshold: suggestedBudget
        }
      });
    }

    const completeDays = context.dailyRows.filter((row) => row.isComplete);

    if (!enabledTypes.has("daily_spend") && completeDays.length >= MIN_COMPLETE_DAYS_FOR_GROUNDING) {
      const stats = distributionStats(completeDays.map((row) => row.totalSpend));
      ranked.push({
        priority: 70,
        recommendation: {
          type: "daily_spend",
          reason: `Your typical complete day costs about ${formatCurrency(stats.median)}, with your higher days running near ${formatCurrency(stats.p90)}. Setting this around ${formatCurrency(stats.p80)} -- above your normal range but below your worst days -- catches a genuinely unusual day without noise from ordinary variation.`,
          suggestedThreshold: stats.p80,
          basedOnCompleteDays: completeDays.length
        }
      });
    }

    if (!enabledTypes.has("daily_kwh") && completeDays.length >= MIN_COMPLETE_DAYS_FOR_GROUNDING) {
      const stats = distributionStats(completeDays.map((row) => row.energyKwh));
      ranked.push({
        priority: 65,
        recommendation: {
          type: "daily_kwh",
          reason: `Your typical complete day uses about ${formatKwh(stats.median)}, with your higher days near ${formatKwh(stats.p90)}. Setting this around ${formatKwh(stats.p80)} flags an unusually heavy-usage day independent of tariff changes, without tripping on normal variation.`,
          suggestedThreshold: stats.p80,
          basedOnCompleteDays: completeDays.length
        }
      });
    }

    if (!enabledTypes.has("usage_anomaly")) {
      ranked.push({
        priority: 50,
        recommendation: {
          type: "usage_anomaly",
          reason: insights?.anomaly.hasEnoughHistory
            ? "Enough usage history has been learned to reliably flag unusual spikes against your own normal pattern."
            : `Still learning your usage pattern (${insights?.anomaly.learningDaysSoFar ?? 0}/${insights?.anomaly.minLearningDays ?? 14} days) -- worth turning on now so it's ready once learning finishes.`,
          suggestedThreshold: null
        }
      });
    }

    if (!enabledTypes.has("tariff_band_approaching") && insights?.band.profile) {
      ranked.push({
        priority: 40,
        recommendation: {
          type: "tariff_band_approaching",
          reason: `Your tariff has stepped bands. This alert warns before you cross into a more expensive one -- currently ${formatKwh(insights.band.monthKwh)} used this month.`,
          suggestedThreshold: null
        }
      });
    }

    if (!enabledTypes.has("data_delayed")) {
      ranked.push({
        priority: 30,
        recommendation: {
          type: "data_delayed",
          reason:
            "Get notified if your data stops syncing for an extended period, so a connection problem doesn't go unnoticed.",
          suggestedThreshold: null
        }
      });
    }

    // Rank by priority and cap -- never dump every applicable type on the
    // user at once, even when several are genuinely grounded.
    const recommendations = ranked
      .sort((left, right) => right.priority - left.priority)
      .slice(0, MAX_RECOMMENDATIONS)
      .map((entry) => entry.recommendation);

    return {
      scope: context.scope,
      recommendations,
      metadata: {
        groundedOnly: true,
        reason: "Only alert types with real supporting data are recommended, ranked and capped to the most useful few.",
        totalCandidates: ranked.length,
        capped: ranked.length > MAX_RECOMMENDATIONS
      }
    };
  }
};
