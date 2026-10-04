import { DEFAULT_THRESHOLDS, type AlertType } from "@/lib/newinmeter/alert-types";
import type { DailyRollupRow } from "@/lib/types";

// Device-local state for the dashboard's prompt cards. These are per-viewer
// conveniences: losing this storage just means a prompt can reappear or the
// welcome-back summary can skip one visit, nothing breaks. Storage access is
// wrapped because private browsing and blocked site data throw on access.
const LAST_VISIT_KEY = "newinmeter:dashboard-last-visit-at";
const PROMPT_DISMISSED_PREFIX = "newinmeter:prompt-dismissed:";

export const WELCOME_BACK_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

// The features a prompt can promote. Alerts is a single feature here even though
// it has several alert types: the prompt names the type that actually triggered.
export const FEATURE_KEYS = ["alerts", "ai", "activities"] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];

// Alert types that can trigger the alerts prompt, in the order they win when
// several trigger at once. Balance first, because running out of power is the
// costliest surprise. Monthly budget is left out: it has no default threshold,
// so there is no fair "over the line" test to show a user.
export const ALERT_PROMPT_PRIORITY = ["low_balance", "daily_spend", "daily_kwh"] as const;
export type AlertPromptType = (typeof ALERT_PROMPT_PRIORITY)[number];

// The subset of an alert rule row the dashboard needs. Structural, so the
// server-loaded AlertRule objects pass straight through.
export type PromptRule = { type: AlertType; enabled: boolean; threshold: number | null };

export type FeatureAdoption = { aiUsed: boolean; activitiesUsed: boolean };

// Percent of real users who have each feature (0-100). Null means unknown,
// which is weighted as if the feature had no users yet.
export type FeatureRates = Partial<Record<FeatureKey, number | null>>;

export type DashboardPrompt = {
  feature: FeatureKey;
  // Only set for the alerts prompt: which alert triggered and by how much.
  alert?: { type: AlertPromptType; value: number; threshold: number; personal: boolean; periodDate?: string };
};

// Floor on the chance a feature is picked. Without it, a feature that almost
// everyone already has would get a weight of zero and never be suggested again.
export const MIN_PROMPT_WEIGHT = 0.05;

export function latestCompleteDay(rows: DailyRollupRow[]): DailyRollupRow | undefined {
  const complete = rows.filter((row) => row.isComplete);
  return complete.sort((left, right) => left.periodDate.localeCompare(right.periodDate)).at(-1);
}

// The calendar day in South Africa, used as the seed for the daily pick. Server
// and client both use it, so the same feature is shown on both sides of hydration.
export function promptDayKey(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Johannesburg",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now);
}

// The alert type that triggered, if any. The user's own threshold wins over the
// default, same rule Settings uses, so the prompt and Settings agree on "too high".
function triggeredAlert(input: {
  rules: PromptRule[];
  latestBalance: number | undefined;
  latestDay: DailyRollupRow | undefined;
}): NonNullable<DashboardPrompt["alert"]> | null {
  for (const type of ALERT_PROMPT_PRIORITY) {
    const rule = input.rules.find((candidate) => candidate.type === type);
    const personal = typeof rule?.threshold === "number";
    const threshold = rule?.threshold ?? DEFAULT_THRESHOLDS[type];
    if (typeof threshold !== "number") {
      continue;
    }

    if (type === "low_balance") {
      const balance = input.latestBalance;
      if (typeof balance === "number" && balance < threshold) {
        return { type, value: balance, threshold, personal };
      }
      continue;
    }

    const day = input.latestDay;
    if (!day) {
      continue;
    }

    const value = type === "daily_spend" ? day.totalSpend : day.energyKwh;
    if (value > threshold) {
      return { type, value, threshold, personal, periodDate: day.periodDate };
    }
  }

  return null;
}

// 32-bit FNV-1a. Turns the day and feature list into a stable number in [0, 1),
// so one day gives one pick and refreshing the page does not change it.
function stableFraction(seed: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash / 0x100000000;
}

// Weight for a feature: the less adopted it is, the more often it is picked.
// adoption 0% -> weight 1, 50% -> 0.5, 100% -> the floor.
export function promptWeight(rate: number | null | undefined): number {
  const adoption = typeof rate === "number" ? Math.min(Math.max(rate, 0), 100) / 100 : 0;
  return Math.max(1 - adoption, MIN_PROMPT_WEIGHT);
}

// Picks one prompt for the day. Every feature the user could still be shown is
// a candidate: alerts when none is on and a threshold is crossed, AI until
// used, Activities until used. Each candidate gets a chance in proportion to
// how few users have it, so features that are not yet adopted surface more
// often, and no feature is shut out. Dismissed features are skipped.
export function pickDashboardPrompt(input: {
  rules: PromptRule[];
  latestBalance: number | undefined;
  latestDay: DailyRollupRow | undefined;
  dismissed: ReadonlySet<FeatureKey>;
  alertsAvailable: boolean;
  aiAvailable: boolean;
  activitiesAvailable: boolean;
  adoption: FeatureAdoption | null;
  rates: FeatureRates;
  dayKey: string;
}): DashboardPrompt | null {
  const candidates: DashboardPrompt[] = [];
  const anyAlertOn = input.rules.some((rule) => rule.enabled);

  if (input.alertsAvailable && !anyAlertOn && !input.dismissed.has("alerts")) {
    const alert = triggeredAlert(input);
    if (alert) {
      candidates.push({ feature: "alerts", alert });
    }
  }

  // AI and Activities need the adoption read. Without it, no prompt is safer
  // than guessing that a feature is unused.
  if (input.adoption) {
    if (input.aiAvailable && !input.adoption.aiUsed && !input.dismissed.has("ai")) {
      candidates.push({ feature: "ai" });
    }
    if (input.activitiesAvailable && !input.adoption.activitiesUsed && !input.dismissed.has("activities")) {
      candidates.push({ feature: "activities" });
    }
  }

  if (candidates.length === 0) {
    return null;
  }

  const weights = candidates.map((candidate) => promptWeight(input.rates[candidate.feature]));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const roll = stableFraction(`${input.dayKey}|${candidates.map((candidate) => candidate.feature).join(",")}`) * total;

  let cumulative = 0;
  for (let index = 0; index < candidates.length; index += 1) {
    cumulative += weights[index];
    if (roll < cumulative) {
      return candidates[index];
    }
  }

  return candidates[candidates.length - 1];
}

export function readDismissedPrompts(): Set<FeatureKey> {
  const dismissed = new Set<FeatureKey>();
  try {
    for (const feature of FEATURE_KEYS) {
      if (window.localStorage.getItem(PROMPT_DISMISSED_PREFIX + feature) === "1") {
        dismissed.add(feature);
      }
    }
  } catch {
    // Storage blocked: nothing is remembered, so prompts may reappear.
  }
  return dismissed;
}

export function dismissPrompt(feature: FeatureKey): void {
  try {
    window.localStorage.setItem(PROMPT_DISMISSED_PREFIX + feature, "1");
  } catch {
    // Best-effort: the card still hides for this page view via component state.
  }
}

export function readLastVisitAt(): number | null {
  try {
    const raw = window.localStorage.getItem(LAST_VISIT_KEY);
    if (!raw) {
      return null;
    }
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

export function writeLastVisitAt(timestamp: number): void {
  try {
    window.localStorage.setItem(LAST_VISIT_KEY, String(timestamp));
  } catch {
    // Best-effort: worst case the welcome-back summary skips a visit.
  }
}

// A first-ever visit has no lastVisitAt, so there is nothing to summarise yet.
export function isWelcomeBackDue(lastVisitAt: number | null, now: number): boolean {
  return lastVisitAt !== null && now - lastVisitAt >= WELCOME_BACK_AFTER_MS;
}

// Sums rows whose periodDate falls after the calendar day of the last visit.
// Compares date strings (YYYY-MM-DD) instead of timestamps so a visit late in
// the evening does not drop that same day's spend from the summary. Uses the
// viewer's local calendar day, not UTC: a UTC slice would be off by one for
// South African visitors between midnight and 02:00 local time.
export function summariseSinceVisit(rows: DailyRollupRow[], lastVisitAt: number) {
  const visited = new Date(lastVisitAt);
  const lastVisitDay = [
    visited.getFullYear(),
    String(visited.getMonth() + 1).padStart(2, "0"),
    String(visited.getDate()).padStart(2, "0")
  ].join("-");
  let spend = 0;
  let kwh = 0;
  let days = 0;

  for (const row of rows) {
    if (row.periodDate > lastVisitDay) {
      spend += row.totalSpend;
      kwh += row.energyKwh;
      days += 1;
    }
  }

  return { spend, kwh, days };
}
