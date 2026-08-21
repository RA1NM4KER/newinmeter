// Pure, dependency-free live-telemetry maths. No "server-only" marker and no
// Supabase access, so every formula is unit-testable in isolation (see
// live-meter-calc.test.ts). The DB access + orchestration lives in
// live-meter.ts.

import type { LiveWindow, SeriesPoint } from "./meter-types";

// A meter LED pulse is 1/pulsesPerKwh kWh of energy. Converting a pulse
// *interval* to instantaneous power:
//
//   energy_per_pulse_kWh = 1 / pulsesPerKwh
//   watts = 3_600_000_000 / (pulsesPerKwh * deltaMs)
//
// For the prototype's 1000 pulses/kWh this reduces to watts = 3_600_000 /
// deltaMs (so a 1000 ms interval is 3600 W). pulsesPerKwh is always read from
// the device -- never hard-coded here.

// A generous residential ceiling. Anything above this is treated as noise /
// a double-counted pulse (an implausibly short interval) and dropped, so one
// bad row can never spike the hero number or explode the graph. This is
// pulsesPerKwh-agnostic: it filters on the computed power, not the raw delta.
export const MAX_PLAUSIBLE_WATTS = 100_000;

// Hero estimate uses a small robust sample so a single fast/slow pulse doesn't
// jump the number, without smoothing so hard it stops feeling live.
export const HERO_SAMPLE_SIZE = 3;

// An estimate is "fresh" while pulses keep arriving at roughly their recent
// cadence; it goes "stale" once the gap clearly exceeds that. Never below
// 10s, so a naturally slow (low-usage) meter isn't declared stale instantly.
export const MIN_FRESHNESS_MS = 10_000;

export function pulseWatts(pulsesPerKwh: number, deltaMs: number | null | undefined): number | null {
  if (deltaMs === null || deltaMs === undefined || !Number.isFinite(deltaMs) || deltaMs <= 0) {
    return null;
  }
  if (!Number.isFinite(pulsesPerKwh) || pulsesPerKwh <= 0) {
    return null;
  }

  const watts = 3_600_000_000 / (pulsesPerKwh * deltaMs);
  if (!Number.isFinite(watts) || watts <= 0 || watts > MAX_PLAUSIBLE_WATTS) {
    return null;
  }

  return watts;
}

export function median(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// `recentDeltasMs` must be most-recent-first. Takes up to HERO_SAMPLE_SIZE
// valid intervals and returns their median power, or null if there aren't
// enough valid intervals to estimate (e.g. only one pulse -> no interval).
export function estimateLoadWatts(recentDeltasMs: Array<number | null>, pulsesPerKwh: number): number | null {
  const samples: number[] = [];
  for (const delta of recentDeltasMs) {
    const watts = pulseWatts(pulsesPerKwh, delta);
    if (watts !== null) {
      samples.push(watts);
      if (samples.length >= HERO_SAMPLE_SIZE) {
        break;
      }
    }
  }
  return median(samples);
}

// Median of the recent valid intervals themselves -- the cadence used to size
// the freshness window.
export function recentMedianIntervalMs(recentDeltasMs: Array<number | null>): number | null {
  const valid: number[] = [];
  for (const delta of recentDeltasMs) {
    if (delta !== null && Number.isFinite(delta) && delta > 0) {
      valid.push(delta);
      if (valid.length >= HERO_SAMPLE_SIZE) {
        break;
      }
    }
  }
  return median(valid);
}

export function freshnessThresholdMs(medianIntervalMs: number | null): number {
  if (medianIntervalMs === null || !Number.isFinite(medianIntervalMs) || medianIntervalMs <= 0) {
    return MIN_FRESHNESS_MS;
  }
  return Math.max(MIN_FRESHNESS_MS, 3 * medianIntervalMs);
}

export function isEstimateFresh(lastPulseAtMs: number, nowMs: number, medianIntervalMs: number | null): boolean {
  return nowMs - lastPulseAtMs <= freshnessThresholdMs(medianIntervalMs);
}

// kWh over a window is just the pulse count scaled by the device resolution.
// Quantisation: resolution is one pulse = 1/pulsesPerKwh kWh (0.001 kWh at
// 1000 pulses/kWh), and a window can clip mid-interval, so very short windows
// carry up to ~1 pulse of rounding error. Acceptable for a "last 5 min /
// last hour" glance; this is explicitly not billing-authoritative.
export function energyKwh(pulseCount: number, pulsesPerKwh: number): number {
  if (!Number.isFinite(pulseCount) || pulseCount <= 0 || pulsesPerKwh <= 0) {
    return 0;
  }
  return pulseCount / pulsesPerKwh;
}

export type RawPulse = { observedAt: string; deltaMs: number | null };

// Buckets pulses into fixed time slots and takes the MEDIAN estimated watts
// per bucket (not the mean of raw deltas -- that would be physically wrong;
// watts is inversely proportional to delta). Empty buckets are omitted rather
// than interpolated, so the graph never fabricates observations. Output is
// chronological and bounded by windowMs / bucketMs (~180 points max per
// window). Pulses whose interval is invalid (including the first pulse after a
// reboot, whose delta is null) are simply skipped.
export function bucketWattsSeries(
  pulses: RawPulse[],
  pulsesPerKwh: number,
  windowStartMs: number,
  windowEndMs: number,
  bucketMs: number
): SeriesPoint[] {
  if (bucketMs <= 0 || windowEndMs <= windowStartMs) {
    return [];
  }

  const buckets = new Map<number, number[]>();

  for (const pulse of pulses) {
    const watts = pulseWatts(pulsesPerKwh, pulse.deltaMs);
    if (watts === null) {
      continue;
    }

    const t = Date.parse(pulse.observedAt);
    if (!Number.isFinite(t) || t < windowStartMs || t > windowEndMs) {
      continue;
    }

    // Epoch-aligned bucket boundary: floor(t / bucketMs) * bucketMs. Crucially
    // this does NOT depend on windowStartMs, so the same physical pulse always
    // lands in the same absolute bucket no matter when the API is called. A
    // refetch 5s later cannot re-bucket historical pulses and make the line
    // move -- the previous windowStart-relative alignment was the primary cause
    // of the graph drifting vertically with no new measurement.
    const bucketStart = Math.floor(t / bucketMs) * bucketMs;
    const existing = buckets.get(bucketStart);
    if (existing) {
      existing.push(watts);
    } else {
      buckets.set(bucketStart, [watts]);
    }
  }

  return Array.from(buckets.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([bucketStart, wattsSamples]) => ({
      timestamp: new Date(bucketStart).toISOString(),
      watts: Math.round(median(wattsSamples) as number)
    }));
}

// Restrained "change over the last minute": current estimated load minus the
// graphed load ~60s ago, in signed watts. Uses the same series the chart shows
// (so the number and the graph agree), and returns null when there is no
// observation close enough to one minute ago -- honest omission rather than a
// misleading figure across a data gap. `toleranceMs` bounds how far a bucket
// may sit from the 60s mark and still count as "a minute ago".
export const CHANGE_LOOKBACK_MS = 60_000;

export function changeWattsLastMinute(
  series: SeriesPoint[],
  estimatedWatts: number | null,
  nowMs: number,
  toleranceMs = 45_000
): number | null {
  if (estimatedWatts === null || series.length === 0) {
    return null;
  }

  const targetMs = nowMs - CHANGE_LOOKBACK_MS;
  let best: SeriesPoint | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const point of series) {
    const t = Date.parse(point.timestamp);
    if (!Number.isFinite(t)) {
      continue;
    }
    const distance = Math.abs(t - targetMs);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = point;
    }
  }

  if (!best || bestDistance > toleranceMs) {
    return null;
  }

  return estimatedWatts - best.watts;
}

// Fixed window -> bucket size map. Every window lands at ~180 points.
export const LIVE_WINDOWS: Record<LiveWindow, { ms: number; bucketMs: number }> = {
  "15m": { ms: 15 * 60_000, bucketMs: 5_000 },
  "30m": { ms: 30 * 60_000, bucketMs: 10_000 },
  "1h": { ms: 60 * 60_000, bucketMs: 20_000 },
  "6h": { ms: 6 * 60 * 60_000, bucketMs: 120_000 }
};

export const DEFAULT_LIVE_WINDOW: LiveWindow = "30m";

export function isLiveWindow(value: unknown): value is LiveWindow {
  return typeof value === "string" && value in LIVE_WINDOWS;
}

// Quantised "nice" watt steps for the Y-axis domain.
const NICE_WATT_STEPS = [50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 20000, 50000, 100000];

// Stable Y-axis domain [low, high] for the live chart.
//
// The step is chosen from the data's magnitude (so the axis granularity suits a
// 300 W fridge or a 7 kW geyser), then low/high are quantised DOWN/UP to that
// step. Because the bounds only move when the data crosses a step boundary,
// insignificant in-range fluctuation leaves the domain -- and therefore every
// plotted point's vertical position -- pixel-stable across refetches. A
// genuinely larger load pushes `high` up by whole steps; the floor stays at 0
// whenever the minimum is within the first step, so normal usage isn't
// dishonestly zoomed. The domain is recomputed only from the current data
// (and thus resets naturally when the window selector changes the data set),
// never re-centred on every new point.
export function niceWattsDomain(values: number[]): [number, number] {
  if (values.length === 0) {
    return [0, 1000];
  }

  const max = Math.max(...values);
  const min = Math.min(...values);
  const target = Math.max(max, 200);
  const step =
    NICE_WATT_STEPS.find((candidate) => target / candidate <= 6) ?? NICE_WATT_STEPS[NICE_WATT_STEPS.length - 1];

  const high = (Math.floor(max / step) + 1) * step;
  const low = Math.max(0, Math.floor(min / step) * step);
  return [low, low === high ? high + step : high];
}

// Presentation helper: W below 1 kW, kW above, so the hero and axis read
// cleanly at both a 300 W fridge and a 7 kW geyser.
export function formatLoad(watts: number): { value: string; unit: "kW" | "W" } {
  if (watts >= 1000) {
    return { value: (watts / 1000).toFixed(2), unit: "kW" };
  }
  return { value: String(Math.round(watts)), unit: "W" };
}
