import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ adminSupabaseRequest: vi.fn() }));

vi.mock("@/lib/supabase-rest", () => ({
  adminSupabaseRequest: mocks.adminSupabaseRequest
}));

import { loadLiveOverview } from "@/lib/live-meter";

const NOW = Date.parse("2026-08-08T12:00:00.000Z");

// Build a snapshot as the live_meter_overview RPC would return it.
function snapshot(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    device: { id: "dev-1", name: "Home meter", pulses_per_kwh: 1000 },
    latest: [
      { observed_at: new Date(NOW - 1000).toISOString(), delta_ms: 1000 },
      { observed_at: new Date(NOW - 2000).toISOString(), delta_ms: 1000 },
      { observed_at: new Date(NOW - 3000).toISOString(), delta_ms: 1000 }
    ],
    series: [
      { observed_at: new Date(NOW - 20 * 60_000).toISOString(), delta_ms: 1000 },
      { observed_at: new Date(NOW - 20 * 60_000 + 2000).toISOString(), delta_ms: 1000 },
      { observed_at: new Date(NOW - 10 * 60_000).toISOString(), delta_ms: 2000 }
    ],
    count5m: 270,
    count1h: 2840,
    ...overrides
  };
}

describe("loadLiveOverview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("calls the single overview RPC scoped to the caller's user id", async () => {
    mocks.adminSupabaseRequest.mockResolvedValue(snapshot());
    await loadLiveOverview("user-a", "30m");

    expect(mocks.adminSupabaseRequest).toHaveBeenCalledTimes(1); // ONE round trip
    const [method, path, params] = mocks.adminSupabaseRequest.mock.calls[0];
    expect(method).toBe("POST");
    expect(path).toBe("/rpc/live_meter_overview");
    expect(params.p_user_id).toBe("user-a");
    expect(params.p_hero_lookback).toBeGreaterThan(0);
    expect(params.p_series_cap).toBeGreaterThan(0);
  });

  it("returns the empty overview when the user has no device", async () => {
    mocks.adminSupabaseRequest.mockResolvedValue(
      snapshot({ device: null, latest: [], series: [], count5m: 0, count1h: 0 })
    );
    const overview = await loadLiveOverview("user-a", "30m");
    expect(overview.device).toBeNull();
    expect(overview.series).toEqual([]);
    expect(overview.latest.estimateState).toBe("waiting");
  });

  it("derives hero watts, energy and series from the snapshot using pulses_per_kwh", async () => {
    mocks.adminSupabaseRequest.mockResolvedValue(snapshot());
    const overview = await loadLiveOverview("user-a", "30m");

    expect(overview.device).toEqual({ name: "Home meter", pulsesPerKwh: 1000 });
    expect(overview.latest.estimatedWatts).toBe(3600); // median of 1000ms intervals at 1000 pk
    expect(overview.latest.estimateState).toBe("fresh");
    expect(overview.energy.last5MinutesKwh).toBeCloseTo(0.27, 10);
    expect(overview.energy.lastHourKwh).toBeCloseTo(2.84, 10);
    expect(overview.series.length).toBeGreaterThan(0);
    expect(overview.series.every((point) => point.watts > 0)).toBe(true);
  });

  it("respects a different pulses_per_kwh for the same intervals", async () => {
    mocks.adminSupabaseRequest.mockResolvedValue(
      snapshot({ device: { id: "dev-1", name: "Home meter", pulses_per_kwh: 2000 } })
    );
    const overview = await loadLiveOverview("user-a", "30m");
    expect(overview.latest.estimatedWatts).toBe(1800); // half the power at double resolution
  });

  it("produces an identical historical series when queried again 5s later with no new pulses", async () => {
    mocks.adminSupabaseRequest.mockResolvedValue(snapshot());
    const first = await loadLiveOverview("user-a", "30m");

    vi.setSystemTime(NOW + 5000); // 5s later, same underlying data
    const second = await loadLiveOverview("user-a", "30m");

    // Epoch-aligned buckets: the same pulses must not move to different buckets
    // just because the API was called later.
    expect(second.series).toEqual(first.series);
  });

  it("rejects a malformed RPC result rather than emitting NaN downstream", async () => {
    mocks.adminSupabaseRequest.mockResolvedValue({ device: { id: "x", name: "y" }, latest: [], series: [] });
    await expect(loadLiveOverview("user-a", "30m")).rejects.toThrow();
  });
});
