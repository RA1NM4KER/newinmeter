import "server-only";

import { z } from "zod";
import {
  bucketWattsSeries,
  changeWattsLastMinute,
  energyKwh,
  estimateLoadWatts,
  isEstimateFresh,
  LIVE_WINDOWS,
  recentMedianIntervalMs
} from "./meter-calc";
import type { EstimateState, LiveOverview, LiveWindow } from "./meter-types";
import { adminSupabaseRequest } from "../supabase-rest";

// Cap the number of raw pulses pulled for the series query, so a very busy
// meter over a 6h window can't return an unbounded row set. The result is
// downsampled to ~180 points regardless; this only bounds the DB read.
const PULSE_QUERY_CAP = 20000;

// How many of the most-recent pulses to inspect for the hero estimate and
// cadence. Small: the hero is the median of the latest few valid intervals.
const HERO_LOOKBACK = 8;

// Contract of the live_meter_overview RPC. Validated on every read so a schema
// drift surfaces as a clear error rather than a silent NaN downstream.
const overviewRpcSchema = z.object({
  device: z.object({ id: z.string(), name: z.string(), pulses_per_kwh: z.number().int().positive() }).nullable(),
  latest: z.array(z.object({ observed_at: z.string(), delta_ms: z.number().nullable() })),
  series: z.array(z.object({ observed_at: z.string(), delta_ms: z.number().nullable() })),
  count5m: z.number().int().nonnegative(),
  count1h: z.number().int().nonnegative()
});

type OverviewRpcResult = z.infer<typeof overviewRpcSchema>;

function emptyOverview(window: LiveWindow, nowMs: number): LiveOverview {
  return {
    device: null,
    window,
    latest: {
      estimatedWatts: null,
      estimateState: "waiting",
      lastPulseAt: null,
      lastDeltaMs: null,
      changeWattsLastMinute: null
    },
    energy: { last5MinutesKwh: 0, lastHourKwh: 0 },
    series: [],
    generatedAt: new Date(nowMs).toISOString()
  };
}

// Fetch device + pulses + counts for the caller's own device in ONE snapshot
// (see the live_meter_overview migration). Scoped strictly by userId; the RPC
// is service-role-only and resolves the device from the user's connections.
async function fetchOverviewSnapshot(
  userId: string,
  windowStartIso: string,
  nowMs: number
): Promise<OverviewRpcResult> {
  const raw = await adminSupabaseRequest<unknown>("POST", "/rpc/live_meter_overview", {
    p_user_id: userId,
    p_window_start: windowStartIso,
    p_five_min: new Date(nowMs - 5 * 60_000).toISOString(),
    p_one_hour: new Date(nowMs - 60 * 60_000).toISOString(),
    p_hero_lookback: HERO_LOOKBACK,
    p_series_cap: PULSE_QUERY_CAP
  });
  return overviewRpcSchema.parse(raw);
}

// Presentation data for the Live page, derived entirely server-side from the
// caller's own device pulses. The browser never reads meter_pulses directly.
export async function loadLiveOverview(userId: string, window: LiveWindow): Promise<LiveOverview> {
  const nowMs = Date.now();
  // Snap the window start DOWN to a bucket boundary so the leftmost bucket is
  // whole and its epoch-aligned key is stable between refetches.
  const bucketMs = LIVE_WINDOWS[window].bucketMs;
  const windowStartMs = Math.floor((nowMs - LIVE_WINDOWS[window].ms) / bucketMs) * bucketMs;

  const snapshot = await fetchOverviewSnapshot(userId, new Date(windowStartMs).toISOString(), nowMs);

  if (!snapshot.device) {
    return emptyOverview(window, nowMs);
  }

  const pulsesPerKwh = snapshot.device.pulses_per_kwh;

  // Hero: median of the latest few valid intervals (most-recent-first). Uses the
  // same per-pulse converter (pulseWatts, inside estimateLoadWatts) as the graph
  // buckets -- the hero is the instantaneous end, the graph is the time-bucketed
  // history, but neither invents a different power model.
  const recentDeltas = snapshot.latest.map((row) => row.delta_ms);
  const estimatedWatts = estimateLoadWatts(recentDeltas, pulsesPerKwh);
  const lastPulseAt = snapshot.latest[0]?.observed_at ?? null;
  const lastDeltaMs = snapshot.latest[0]?.delta_ms ?? null;

  let estimateState: EstimateState;
  if (estimatedWatts === null || lastPulseAt === null) {
    // 0 or 1 pulse, or no valid interval -> not enough to estimate power yet.
    estimateState = "waiting";
  } else {
    const medianInterval = recentMedianIntervalMs(recentDeltas);
    estimateState = isEstimateFresh(Date.parse(lastPulseAt), nowMs, medianInterval) ? "fresh" : "stale";
  }

  const series = bucketWattsSeries(
    snapshot.series.map((row) => ({ observedAt: row.observed_at, deltaMs: row.delta_ms })),
    pulsesPerKwh,
    windowStartMs,
    nowMs,
    bucketMs
  );

  // Only show a minute-over-minute change for a fresh estimate (a stale reading
  // has no meaningful "now" to compare against).
  const rawChange = estimateState === "fresh" ? changeWattsLastMinute(series, estimatedWatts, nowMs) : null;

  return {
    device: { name: snapshot.device.name, pulsesPerKwh },
    window,
    latest: {
      estimatedWatts: estimatedWatts === null ? null : Math.round(estimatedWatts),
      estimateState,
      lastPulseAt,
      lastDeltaMs,
      changeWattsLastMinute: rawChange === null ? null : Math.round(rawChange)
    },
    energy: {
      last5MinutesKwh: energyKwh(snapshot.count5m, pulsesPerKwh),
      lastHourKwh: energyKwh(snapshot.count1h, pulsesPerKwh)
    },
    series,
    generatedAt: new Date(nowMs).toISOString()
  };
}
