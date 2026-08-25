export type DemoPoint = {
  time: string;
  kwh: number;
};

export type DemoActivity = {
  label: string;
  startIndex: number;
  endIndex: number;
  time: string;
};

export type DemoScenarioId = "normal" | "evening" | "lateNight";

export type DemoScenario = {
  id: DemoScenarioId;
  label: string;
  points: DemoPoint[];
  focusIndex: number;
  activity?: DemoActivity;
  insight: string;
  assistant: string;
};

const times = Array.from({ length: 24 }, (_, index) => {
  const totalMinutes = 12 * 60 + index * 30;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
});

function points(values: number[]): DemoPoint[] {
  return values.map((kwh, index) => ({ time: times[index], kwh }));
}

export const DEMO_TARIFF = 3.575;

export const demoScenarios: Record<DemoScenarioId, DemoScenario> = {
  normal: {
    id: "normal",
    label: "Normal day",
    points: points([
      0.12, 0.1, 0.11, 0.14, 0.13, 0.12, 0.16, 0.2, 0.18, 0.24, 0.3, 0.36, 0.42, 0.38, 0.31, 0.26, 0.22, 0.2, 0.18,
      0.16, 0.15, 0.14, 0.12, 0.11
    ]),
    focusIndex: 12,
    insight: "Usage stayed close to this household's usual evening shape.",
    assistant:
      "Tuesday followed the recent pattern. The busiest half-hour was 18:00, with no Activity recorded over it."
  },
  evening: {
    id: "evening",
    label: "Evening spike",
    points: points([
      0.11, 0.1, 0.12, 0.14, 0.15, 0.13, 0.16, 0.22, 0.29, 0.4, 0.61, 0.82, 1.02, 1.18, 0.91, 0.48, 0.26, 0.22, 0.19,
      0.17, 0.15, 0.13, 0.12, 0.1
    ]),
    focusIndex: 13,
    activity: { label: "Cooking", startIndex: 10, endIndex: 15, time: "17:00–19:30" },
    insight: "The largest increase sits inside the period labelled Cooking.",
    assistant:
      "Most of Tuesday's electricity spend happened between 17:00 and 20:00. The largest spike overlaps your Cooking Activity."
  },
  lateNight: {
    id: "lateNight",
    label: "Late night",
    points: points([
      0.1, 0.1, 0.11, 0.13, 0.14, 0.12, 0.14, 0.18, 0.19, 0.22, 0.28, 0.34, 0.41, 0.37, 0.3, 0.24, 0.2, 0.18, 0.16,
      0.22, 0.88, 1.46, 0.96, 0.39
    ]),
    focusIndex: 21,
    activity: { label: "Geyser", startIndex: 20, endIndex: 24, time: "22:00–00:00" },
    insight: "22:30 was the day's largest late-night spike.",
    assistant:
      "The late-night spike overlaps your Geyser Activity. Most of Tuesday's electricity spend after 22:00 was recorded in that window."
  }
};

export const scenarioOrder: DemoScenarioId[] = ["normal", "evening", "lateNight"];

export function sumUsage(pointsToSum: DemoPoint[]): number {
  return pointsToSum.reduce((total, point) => total + point.kwh, 0);
}

export function spendFor(kwh: number): number {
  return kwh * DEMO_TARIFF;
}

export function formatRand(value: number): string {
  return `R${value.toFixed(2)}`;
}

export function formatKwh(value: number): string {
  return `${value.toFixed(value >= 10 ? 1 : 2)} kWh`;
}
