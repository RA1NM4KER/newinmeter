import { describe, expect, it } from "vitest";
import {
  bucketWattsSeries,
  changeWattsLastMinute,
  energyKwh,
  estimateLoadWatts,
  formatLoad,
  freshnessThresholdMs,
  isEstimateFresh,
  isLiveWindow,
  LIVE_WINDOWS,
  MAX_PLAUSIBLE_WATTS,
  niceWattsDomain,
  pulseWatts,
  recentMedianIntervalMs
} from "@/lib/live/meter-calc";
import type { SeriesPoint } from "@/lib/live/meter-types";

describe("pulseWatts", () => {
  it("uses pulsesPerKwh, not a hard-coded 1000", () => {
    // Same 1000ms interval at different resolutions yields different power.
    expect(pulseWatts(1000, 1000)).toBe(3600);
    expect(pulseWatts(2000, 1000)).toBe(1800);
    expect(pulseWatts(500, 1000)).toBe(7200);
  });

  it("computes 3600 W for 1000 pulses/kWh at a 1000 ms interval", () => {
    expect(pulseWatts(1000, 1000)).toBe(3600);
  });

  it("rejects zero, negative and non-finite deltas (no division by zero)", () => {
    expect(pulseWatts(1000, 0)).toBeNull();
    expect(pulseWatts(1000, -5)).toBeNull();
    expect(pulseWatts(1000, null)).toBeNull();
    expect(pulseWatts(1000, Number.NaN)).toBeNull();
    expect(pulseWatts(1000, Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("rejects an implausibly short interval that would exceed the power ceiling", () => {
    // 1 ms at 1000 pulses/kWh -> 3.6 MW, filtered as noise.
    expect(pulseWatts(1000, 1)).toBeNull();
    expect(pulseWatts(1000, 40)).toBeLessThanOrEqual(MAX_PLAUSIBLE_WATTS);
  });

  it("rejects a non-positive pulsesPerKwh", () => {
    expect(pulseWatts(0, 1000)).toBeNull();
    expect(pulseWatts(-1000, 1000)).toBeNull();
  });
});

describe("estimateLoadWatts", () => {
  it("takes the median of the latest 3 valid intervals to stabilise the hero", () => {
    // Most-recent-first: 1000ms(3600W), 900ms(4000W), 1200ms(3000W) -> median 3600.
    expect(estimateLoadWatts([1000, 900, 1200], 1000)).toBe(3600);
  });

  it("ignores invalid intervals when choosing the sample", () => {
    // 0 and null skipped; first three VALID are 1000/1000/1000 -> 3600.
    expect(estimateLoadWatts([0, null, 1000, 1000, 1000, 500], 1000)).toBe(3600);
  });

  it("returns null when there is no valid interval (e.g. a single pulse)", () => {
    expect(estimateLoadWatts([], 1000)).toBeNull();
    expect(estimateLoadWatts([null], 1000)).toBeNull();
  });

  it("does not over-smooth: only the latest few intervals matter", () => {
    // A long tail of slow pulses should not drag a recent fast burst down.
    expect(estimateLoadWatts([500, 500, 500, 100000, 100000], 1000)).toBe(7200);
  });
});

describe("freshness", () => {
  it("threshold is at least 10s and otherwise ~3x the recent cadence", () => {
    expect(freshnessThresholdMs(null)).toBe(10_000);
    expect(freshnessThresholdMs(1000)).toBe(10_000); // 3s < floor
    expect(freshnessThresholdMs(10_000)).toBe(30_000);
  });

  it("marks fresh within the threshold and stale beyond it", () => {
    const now = 1_000_000;
    // cadence 10s -> threshold 30s
    expect(isEstimateFresh(now - 20_000, now, 10_000)).toBe(true);
    expect(isEstimateFresh(now - 40_000, now, 10_000)).toBe(false);
  });

  it("uses the 10s floor for a fast meter so it isn't declared stale instantly", () => {
    const now = 1_000_000;
    expect(isEstimateFresh(now - 8_000, now, 1000)).toBe(true);
  });
});

describe("recentMedianIntervalMs", () => {
  it("medians up to the latest 3 valid intervals", () => {
    expect(recentMedianIntervalMs([1000, 2000, 3000, 9999])).toBe(2000);
    expect(recentMedianIntervalMs([null, 0, 1500])).toBe(1500);
    expect(recentMedianIntervalMs([])).toBeNull();
  });
});

describe("energyKwh", () => {
  it("is pulseCount / pulsesPerKwh", () => {
    expect(energyKwh(270, 1000)).toBeCloseTo(0.27, 10);
    expect(energyKwh(2840, 1000)).toBeCloseTo(2.84, 10);
    expect(energyKwh(270, 2000)).toBeCloseTo(0.135, 10);
  });

  it("is zero for no pulses or an invalid resolution", () => {
    expect(energyKwh(0, 1000)).toBe(0);
    expect(energyKwh(-5, 1000)).toBe(0);
    expect(energyKwh(100, 0)).toBe(0);
  });
});

describe("bucketWattsSeries", () => {
  const ppk = 1000;
  const start = Date.parse("2026-08-07T10:00:00.000Z");
  const end = start + 60_000;

  function at(offsetMs: number) {
    return new Date(start + offsetMs).toISOString();
  }

  it("produces chronological, bounded, median-watt buckets", () => {
    const pulses = [
      { observedAt: at(1000), deltaMs: 1000 }, // 3600 W
      { observedAt: at(2000), deltaMs: 1200 }, // 3000 W -- same 10s bucket
      { observedAt: at(3000), deltaMs: 900 }, //  4000 W -- same 10s bucket
      { observedAt: at(15000), deltaMs: 2000 } // 1800 W -- later bucket
    ];
    const series = bucketWattsSeries(pulses, ppk, start, end, 10_000);
    expect(series.map((p) => p.timestamp)).toEqual([...series].map((p) => p.timestamp).sort());
    expect(series).toHaveLength(2);
    expect(series[0].watts).toBe(3600); // median of 3600,3000,4000
    expect(series[1].watts).toBe(1800);
  });

  it("bounds output points to windowMs / bucketMs", () => {
    const bucketMs = LIVE_WINDOWS["15m"].bucketMs;
    const windowMs = LIVE_WINDOWS["15m"].ms;
    const pulses = Array.from({ length: 5000 }, (_, i) => ({
      observedAt: new Date(start + (i * windowMs) / 5000).toISOString(),
      deltaMs: 1000
    }));
    const series = bucketWattsSeries(pulses, ppk, start, start + windowMs, bucketMs);
    expect(series.length).toBeLessThanOrEqual(windowMs / bucketMs);
  });

  it("skips reboot boundary pulses (null delta) without breaking", () => {
    const pulses = [
      { observedAt: at(1000), deltaMs: null }, // first pulse of a boot -> excluded
      { observedAt: at(2000), deltaMs: 1000 }
    ];
    const series = bucketWattsSeries(pulses, ppk, start, end, 10_000);
    expect(series).toHaveLength(1);
    expect(series[0].watts).toBe(3600);
  });

  it("uses delta for watts even if observed_at is bunched (legacy rows)", () => {
    // Three pulses sharing one bunched observed_at, but with valid distinct
    // deltas -> one bucket, median of the correct per-pulse watts.
    const pulses = [
      { observedAt: at(5000), deltaMs: 1000 }, // 3600
      { observedAt: at(5000), deltaMs: 1000 }, // 3600
      { observedAt: at(5000), deltaMs: 2000 } //  1800
    ];
    const series = bucketWattsSeries(pulses, ppk, start, end, 10_000);
    expect(series).toHaveLength(1);
    expect(series[0].watts).toBe(3600); // median(3600,3600,1800)
  });

  it("does not fabricate points for empty windows", () => {
    expect(bucketWattsSeries([], ppk, start, end, 10_000)).toEqual([]);
  });

  it("assigns pulses to STABLE epoch-aligned buckets regardless of windowStart (no drift on refetch)", () => {
    // Same physical pulses, all comfortably inside both windows; two
    // windowStart values 5s apart (as if the API was called 5s later).
    // Historical buckets must be byte-identical -- the drift bug came from
    // windowStart-relative bucket boundaries re-aligning the same pulses.
    const pulses = [
      { observedAt: at(12000), deltaMs: 1000 },
      { observedAt: at(17000), deltaMs: 1200 },
      { observedAt: at(33000), deltaMs: 900 }
    ];
    const a = bucketWattsSeries(pulses, ppk, start, start + 60_000, 10_000);
    const b = bucketWattsSeries(pulses, ppk, start + 5000, start + 65_000, 10_000);
    expect(a).toEqual(b);
    // And the bucket keys are epoch-aligned (multiples of bucketMs).
    for (const point of a) {
      expect(Date.parse(point.timestamp) % 10_000).toBe(0);
    }
  });

  it("adding a newer pulse never re-buckets earlier points (partial latest bucket is isolated)", () => {
    const earlier = [
      { observedAt: at(2000), deltaMs: 1000 },
      { observedAt: at(12000), deltaMs: 1200 }
    ];
    const withNew = [...earlier, { observedAt: at(45000), deltaMs: 900 }];
    const before = bucketWattsSeries(earlier, ppk, start, start + 60_000, 10_000);
    const after = bucketWattsSeries(withNew, ppk, start, start + 60_000, 10_000);
    // Every earlier bucket is unchanged; only a new trailing bucket is added.
    expect(after.slice(0, before.length)).toEqual(before);
    expect(after.length).toBe(before.length + 1);
  });

  it("drops one absurd row instead of exploding the series", () => {
    const pulses = [
      { observedAt: at(1000), deltaMs: 1000 },
      { observedAt: at(11000), deltaMs: 0.0001 } // absurd -> filtered
    ];
    const series = bucketWattsSeries(pulses, ppk, start, end, 10_000);
    expect(series).toHaveLength(1);
    expect(series[0].watts).toBe(3600);
  });
});

describe("estimator coherence (hero vs graph share one per-pulse model)", () => {
  it("a single-interval hero estimate equals that interval's bucket value", () => {
    const ppk = 1000;
    const start = Date.parse("2026-08-08T10:00:00.000Z");
    // Hero: median of the last valid interval(s).
    const hero = estimateLoadWatts([1500], ppk);
    // Graph: a bucket containing exactly that one pulse.
    const series = bucketWattsSeries(
      [{ observedAt: new Date(start + 1000).toISOString(), deltaMs: 1500 }],
      ppk,
      start,
      start + 60_000,
      10_000
    );
    expect(hero).toBe(pulseWatts(ppk, 1500));
    expect(series[0].watts).toBe(Math.round(pulseWatts(ppk, 1500) as number));
  });
});

describe("changeWattsLastMinute", () => {
  const now = Date.parse("2026-08-07T10:30:00.000Z");
  const series: SeriesPoint[] = [
    { timestamp: new Date(now - 120_000).toISOString(), watts: 1000 },
    { timestamp: new Date(now - 60_000).toISOString(), watts: 1400 }, // ~1 min ago
    { timestamp: new Date(now - 10_000).toISOString(), watts: 3200 }
  ];

  it("returns signed change vs the load ~1 minute ago", () => {
    expect(changeWattsLastMinute(series, 3240, now)).toBe(3240 - 1400);
  });

  it("returns null when there is no observation near one minute ago", () => {
    const sparse: SeriesPoint[] = [{ timestamp: new Date(now - 5_000).toISOString(), watts: 3200 }];
    expect(changeWattsLastMinute(sparse, 3240, now)).toBeNull();
  });

  it("returns null when there is no current estimate or no series", () => {
    expect(changeWattsLastMinute(series, null, now)).toBeNull();
    expect(changeWattsLastMinute([], 3240, now)).toBeNull();
  });
});

describe("windows and formatting", () => {
  it("validates window values strictly", () => {
    expect(isLiveWindow("30m")).toBe(true);
    expect(isLiveWindow("15m")).toBe(true);
    expect(isLiveWindow("2h")).toBe(false);
    expect(isLiveWindow("")).toBe(false);
    expect(isLiveWindow(30)).toBe(false);
  });

  it("every window lands at roughly 180 points", () => {
    for (const { ms, bucketMs } of Object.values(LIVE_WINDOWS)) {
      expect(ms / bucketMs).toBeLessThanOrEqual(200);
      expect(ms / bucketMs).toBeGreaterThanOrEqual(100);
    }
  });

  it("formats load in W below 1kW and kW above", () => {
    expect(formatLoad(820)).toEqual({ value: "820", unit: "W" });
    expect(formatLoad(3270)).toEqual({ value: "3.27", unit: "kW" });
  });
});

describe("niceWattsDomain", () => {
  it("stays fixed for insignificant in-range fluctuation (graph does not breathe)", () => {
    // A ~3 kW load wobbling between 2900 and 3100 W keeps the same quantised
    // domain across refetches.
    const a = niceWattsDomain([2900, 3000, 3100]);
    const b = niceWattsDomain([2920, 3010, 3080]);
    expect(a).toEqual(b);
  });

  it("expands predictably when a genuinely larger load arrives", () => {
    const [, highBefore] = niceWattsDomain([2900, 3100]);
    const [, highAfter] = niceWattsDomain([2900, 5200]);
    expect(highAfter).toBeGreaterThan(highBefore);
  });

  it("keeps every point strictly inside the domain (headroom above the max)", () => {
    const values = [1000, 2000, 3000];
    const [low, high] = niceWattsDomain(values);
    expect(low).toBeLessThanOrEqual(Math.min(...values));
    expect(high).toBeGreaterThan(Math.max(...values));
  });

  it("uses a low floor of 0 when the minimum is within the first step", () => {
    const [low] = niceWattsDomain([40, 300, 480]); // min 40 < step (100) -> floor to 0
    expect(low).toBe(0);
  });

  it("returns a sane default for empty data", () => {
    expect(niceWattsDomain([])).toEqual([0, 1000]);
  });
});
