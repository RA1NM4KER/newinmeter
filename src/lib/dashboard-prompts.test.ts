import { describe, expect, it } from "vitest";
import {
  MIN_PROMPT_WEIGHT,
  WELCOME_BACK_AFTER_MS,
  isWelcomeBackDue,
  latestCompleteDay,
  pickDashboardPrompt,
  promptWeight,
  summariseSinceVisit,
  type FeatureAdoption,
  type FeatureKey,
  type FeatureRates,
  type PromptRule
} from "./dashboard-prompts";
import type { DailyRollupRow } from "./types";

function row(periodDate: string, totalSpend: number, energyKwh: number, isComplete = true): DailyRollupRow {
  return {
    periodDate,
    energySpend: totalSpend,
    waterSpend: 0,
    fixedSpend: 0,
    topupAmount: 0,
    totalSpend,
    energyKwh,
    waterKl: 0,
    weightedTariff: 0,
    peakTariff: 0,
    allInRate: 0,
    balanceEnd: 0,
    energyIntervals: 0,
    waterIntervals: 0,
    isComplete
  };
}

// Defaults in alert-types.ts: low_balance 200, daily_spend 50, daily_kwh 10.
const fresh: FeatureAdoption = { aiUsed: false, activitiesUsed: false };
const base = {
  rules: [] as PromptRule[],
  latestBalance: 1000,
  latestDay: row("2026-10-03", 10, 2),
  dismissed: new Set<FeatureKey>(),
  alertsAvailable: true,
  aiAvailable: true,
  activitiesAvailable: true,
  adoption: fresh,
  rates: {} as FeatureRates,
  dayKey: "2026-10-04"
};

// The feature picked for each day key, for a given set of inputs.
function pickedAcrossDays(input: Partial<Parameters<typeof pickDashboardPrompt>[0]>, days: number) {
  const counts: Record<string, number> = {};
  for (let offset = 0; offset < days; offset += 1) {
    const date = new Date(Date.UTC(2026, 0, 1) + offset * 86_400_000).toISOString().slice(0, 10);
    const prompt = pickDashboardPrompt({ ...base, ...input, dayKey: date });
    const key = prompt?.feature ?? "none";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

describe("pickDashboardPrompt: eligibility", () => {
  it("offers low balance when no alert is on and balance is under the default threshold", () => {
    expect(pickDashboardPrompt({ ...base, latestBalance: 150, adoption: null })).toMatchObject({
      feature: "alerts",
      alert: { type: "low_balance", value: 150, threshold: 200 }
    });
  });

  it("uses the user's own rule threshold over the default", () => {
    const rules: PromptRule[] = [{ type: "low_balance", enabled: false, threshold: 500 }];
    const prompt = pickDashboardPrompt({ ...base, rules, latestBalance: 400, adoption: null });
    expect(prompt?.alert?.threshold).toBe(500);
  });

  it("marks a threshold as personal only when the user saved it", () => {
    const saved: PromptRule[] = [{ type: "low_balance", enabled: false, threshold: 300 }];
    expect(pickDashboardPrompt({ ...base, rules: saved, latestBalance: 250, adoption: null })?.alert?.personal).toBe(
      true
    );
    expect(pickDashboardPrompt({ ...base, latestBalance: 150, adoption: null })?.alert?.personal).toBe(false);
  });

  it("offers a big spend day above the daily spend threshold", () => {
    const prompt = pickDashboardPrompt({ ...base, latestDay: row("2026-10-03", 80, 3), adoption: null });
    expect(prompt?.alert).toEqual({
      type: "daily_spend",
      value: 80,
      threshold: 50,
      personal: false,
      periodDate: "2026-10-03"
    });
  });

  it("hides every alert prompt once any alert is on", () => {
    const prompt = pickDashboardPrompt({
      ...base,
      rules: [{ type: "daily_spend", enabled: true, threshold: null }],
      latestBalance: 150,
      adoption: null
    });
    expect(prompt).toBeNull();
  });

  it("offers AI and Activities regardless of whether alerts are on", () => {
    const rules: PromptRule[] = [{ type: "low_balance", enabled: true, threshold: null }];
    expect(["ai", "activities"]).toContain(pickDashboardPrompt({ ...base, rules, latestBalance: 1000 })?.feature);
    expect(
      pickDashboardPrompt({ ...base, latestBalance: 1000, adoption: { aiUsed: true, activitiesUsed: false } })?.feature
    ).toBe("activities");
  });

  it("does not offer AI to a user who already used it", () => {
    const prompt = pickDashboardPrompt({
      ...base,
      latestBalance: 1000,
      adoption: { aiUsed: true, activitiesUsed: true }
    });
    expect(prompt).toBeNull();
  });

  it("shows no AI or Activities prompt when adoption could not be read", () => {
    expect(pickDashboardPrompt({ ...base, latestBalance: 1000, adoption: null })).toBeNull();
  });

  it("skips a dismissed feature and leaves the others eligible", () => {
    const prompt = pickDashboardPrompt({
      ...base,
      latestBalance: 1000,
      dismissed: new Set<FeatureKey>(["ai"]),
      adoption: fresh
    });
    expect(prompt?.feature).toBe("activities");
  });

  it("skips features the user does not have access to", () => {
    expect(
      pickDashboardPrompt({ ...base, latestBalance: 1000, aiAvailable: false, activitiesAvailable: false })
    ).toBeNull();
  });

  it("returns null when nothing is eligible", () => {
    expect(
      pickDashboardPrompt({
        ...base,
        latestBalance: 1000,
        alertsAvailable: false,
        aiAvailable: false,
        activitiesAvailable: false
      })
    ).toBeNull();
  });
});

describe("pickDashboardPrompt: daily pick", () => {
  it("returns the same prompt for the same day, so refreshing does not change it", () => {
    const first = pickDashboardPrompt({ ...base, latestBalance: 1000, rates: { ai: 40 } });
    const second = pickDashboardPrompt({ ...base, latestBalance: 1000, rates: { ai: 40 } });
    expect(second).toEqual(first);
  });

  it("gives a feature with lower adoption more days than one most users already have", () => {
    // AI at 90% adoption, Activities at 10%: Activities should win most days.
    const counts = pickedAcrossDays({ latestBalance: 1000, rates: { ai: 90, activities: 10 } }, 1000);
    expect(counts.activities).toBeGreaterThan(counts.ai * 3);
  });

  it("still gives a fully adopted feature some days, so nothing is shut out", () => {
    const counts = pickedAcrossDays({ latestBalance: 1000, rates: { ai: 100, activities: 0 } }, 1000);
    expect(counts.ai ?? 0).toBeGreaterThan(0);
  });

  it("treats unknown rates as equal chance", () => {
    const counts = pickedAcrossDays({ latestBalance: 1000, rates: {} }, 1000);
    expect(Math.abs(counts.ai - counts.activities)).toBeLessThan(120);
  });
});

describe("promptWeight", () => {
  it("is 1 at 0% adoption and falls as adoption rises", () => {
    expect(promptWeight(0)).toBe(1);
    expect(promptWeight(50)).toBe(0.5);
  });

  it("never drops below the floor, even at 100%", () => {
    expect(promptWeight(100)).toBe(MIN_PROMPT_WEIGHT);
  });

  it("treats unknown adoption as 0%", () => {
    expect(promptWeight(null)).toBe(1);
    expect(promptWeight(undefined)).toBe(1);
  });
});

describe("latestCompleteDay", () => {
  it("ignores an incomplete latest day", () => {
    const rows = [row("2026-10-02", 40, 4), row("2026-10-03", 5, 0.5, false)];
    expect(latestCompleteDay(rows)?.periodDate).toBe("2026-10-02");
  });
});

describe("isWelcomeBackDue", () => {
  const now = Date.parse("2026-10-04T12:00:00Z");

  it("is not due on a first-ever visit", () => {
    expect(isWelcomeBackDue(null, now)).toBe(false);
  });

  it("is not due just under seven days away", () => {
    expect(isWelcomeBackDue(now - WELCOME_BACK_AFTER_MS + 1, now)).toBe(false);
  });

  it("is due at exactly seven days away", () => {
    expect(isWelcomeBackDue(now - WELCOME_BACK_AFTER_MS, now)).toBe(true);
  });
});

describe("summariseSinceVisit", () => {
  it("sums only days after the calendar day of the last visit", () => {
    // Local-time visit on 2026-09-20; the 20th itself must not be counted again.
    const lastVisitAt = new Date(2026, 8, 20, 22, 30).getTime();
    const rows = [
      row("2026-09-19", 100, 10),
      row("2026-09-20", 50, 5),
      row("2026-09-21", 30, 3),
      row("2026-09-25", 20, 2)
    ];

    expect(summariseSinceVisit(rows, lastVisitAt)).toEqual({ spend: 50, kwh: 5, days: 2 });
  });

  it("returns zeros when no rows follow the visit", () => {
    const lastVisitAt = new Date(2026, 8, 20, 9, 0).getTime();
    expect(summariseSinceVisit([row("2026-09-19", 100, 10)], lastVisitAt)).toEqual({ spend: 0, kwh: 0, days: 0 });
  });
});
