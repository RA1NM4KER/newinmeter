import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  adminSupabaseRequest: vi.fn(),
  adminSupabaseRawResponse: vi.fn(),
  hasFeatureAccess: vi.fn()
}));

vi.mock("@/lib/supabase-rest", () => ({
  adminSupabaseRequest: mocks.adminSupabaseRequest,
  adminSupabaseRawResponse: mocks.adminSupabaseRawResponse
}));
vi.mock("@/lib/features", () => ({
  hasFeatureAccess: mocks.hasFeatureAccess
}));

import { generateDeviceKey, hashDeviceKey } from "@/lib/meter-device-keys";
import {
  authenticateDeviceKey,
  buildPulseRows,
  isLiveMeterEnabledForDevice,
  recordPulses,
  touchDeviceLastSeen,
  type MeterDevice,
  type PulseInput
} from "@/lib/meter-devices";

const enabledDeviceRow = {
  id: "device-a",
  connection_id: "connection-a",
  name: "Home meter",
  enabled: true,
  pulses_per_kwh: 1000,
  livemopay_connections: { user_id: "user-a" }
};

const device: MeterDevice = {
  id: "device-a",
  connectionId: "connection-a",
  ownerUserId: "user-a",
  name: "Home meter",
  enabled: true,
  pulsesPerKwh: 1000
};

describe("authenticateDeviceKey", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null for a missing/malformed header without querying the database", async () => {
    expect(await authenticateDeviceKey(null)).toBeNull();
    expect(await authenticateDeviceKey("Basic abc")).toBeNull();
    expect(await authenticateDeviceKey("Bearer not-a-device-key")).toBeNull();
    expect(mocks.adminSupabaseRequest).not.toHaveBeenCalled();
  });

  it("looks a device up by the hash of the key, never the raw key", async () => {
    const key = generateDeviceKey();
    mocks.adminSupabaseRequest.mockResolvedValue([enabledDeviceRow]);

    await authenticateDeviceKey(`Bearer ${key}`);

    const [, path] = mocks.adminSupabaseRequest.mock.calls[0];
    expect(path).toContain(hashDeviceKey(key));
    expect(path).not.toContain(key);
  });

  it("returns null for an unknown key (no matching row)", async () => {
    mocks.adminSupabaseRequest.mockResolvedValue([]);
    expect(await authenticateDeviceKey(`Bearer ${generateDeviceKey()}`)).toBeNull();
  });

  it("returns null for a disabled device", async () => {
    mocks.adminSupabaseRequest.mockResolvedValue([{ ...enabledDeviceRow, enabled: false }]);
    expect(await authenticateDeviceKey(`Bearer ${generateDeviceKey()}`)).toBeNull();
  });

  it("returns the mapped device (with owner user id) for a valid, enabled key", async () => {
    mocks.adminSupabaseRequest.mockResolvedValue([enabledDeviceRow]);
    const resolved = await authenticateDeviceKey(`Bearer ${generateDeviceKey()}`);
    expect(resolved).toEqual(device);
  });

  it("returns null when the owning connection can't be resolved", async () => {
    mocks.adminSupabaseRequest.mockResolvedValue([{ ...enabledDeviceRow, livemopay_connections: null }]);
    expect(await authenticateDeviceKey(`Bearer ${generateDeviceKey()}`)).toBeNull();
  });
});

describe("isLiveMeterEnabledForDevice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("checks the flag against the device owner, not the request", async () => {
    mocks.hasFeatureAccess.mockResolvedValue(true);
    expect(await isLiveMeterEnabledForDevice(device)).toBe(true);
    expect(mocks.hasFeatureAccess).toHaveBeenCalledWith("user-a", "live");
  });

  it("is false when the owner does not have the feature enabled", async () => {
    mocks.hasFeatureAccess.mockResolvedValue(false);
    expect(await isLiveMeterEnabledForDevice(device)).toBe(false);
  });
});

describe("buildPulseRows", () => {
  const pulses: PulseInput[] = [
    { seq: 1, timestampMs: 1786127342184, uptimeMs: 14573, deltaMs: null },
    { seq: 2, timestampMs: 1786127343992, uptimeMs: 16381, deltaMs: 1808 }
  ];

  it("binds every row to the authenticated device and boot id", () => {
    const rows = buildPulseRows("device-a", "boot-x", pulses);
    expect(rows.every((row) => row.device_id === "device-a")).toBe(true);
    expect(rows.every((row) => row.boot_id === "boot-x")).toBe(true);
  });

  it("converts timestampMs to an ISO timestamptz for observed_at", () => {
    const [first] = buildPulseRows("device-a", "boot-x", pulses);
    expect(first.observed_at).toBe(new Date(1786127342184).toISOString());
  });

  it("preserves seq, uptime and nullable delta verbatim", () => {
    const rows = buildPulseRows("device-a", "boot-x", pulses);
    expect(rows[0]).toMatchObject({ seq: 1, uptime_ms: 14573, delta_ms: null });
    expect(rows[1]).toMatchObject({ seq: 2, uptime_ms: 16381, delta_ms: 1808 });
  });
});

describe("recordPulses", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const pulses: PulseInput[] = [
    { seq: 1, timestampMs: 1786127342184, uptimeMs: 14573, deltaMs: null },
    { seq: 2, timestampMs: 1786127343992, uptimeMs: 16381, deltaMs: 1808 }
  ];

  it("upserts with ignore-duplicates against the (device_id,boot_id,seq) constraint", async () => {
    mocks.adminSupabaseRequest.mockResolvedValue([{ id: 1 }, { id: 2 }]);
    await recordPulses("device-a", "boot-x", pulses);

    const [method, path, body, prefer] = mocks.adminSupabaseRequest.mock.calls[0];
    expect(method).toBe("POST");
    expect(path).toContain("on_conflict=device_id,boot_id,seq");
    expect(prefer).toContain("resolution=ignore-duplicates");
    expect(Array.isArray(body)).toBe(true);
  });

  it("counts accepted = inserted rows and duplicates = submitted - inserted", async () => {
    // Only one of the two submitted rows was actually inserted (the other
    // already existed) -- exactly the HTTP-retry idempotency case.
    mocks.adminSupabaseRequest.mockResolvedValue([{ id: 2 }]);
    const result = await recordPulses("device-a", "boot-x", pulses);
    expect(result).toEqual({ accepted: 1, duplicates: 1 });
  });

  it("reports zero accepted when an identical batch is fully replayed", async () => {
    mocks.adminSupabaseRequest.mockResolvedValue([]);
    const result = await recordPulses("device-a", "boot-x", pulses);
    expect(result).toEqual({ accepted: 0, duplicates: 2 });
  });
});

describe("touchDeviceLastSeen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("patches last_seen_at for the device and does not throw on failure", async () => {
    mocks.adminSupabaseRawResponse.mockResolvedValue({ ok: false, status: 500 });
    await expect(touchDeviceLastSeen("device-a")).resolves.toBeUndefined();

    const [method, path, body] = mocks.adminSupabaseRawResponse.mock.calls[0];
    expect(method).toBe("PATCH");
    expect(path).toContain("device-a");
    expect(body).toHaveProperty("last_seen_at");
  });
});
