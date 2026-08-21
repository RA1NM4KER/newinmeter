import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticateDeviceKey: vi.fn(),
  isLiveMeterEnabledForDevice: vi.fn(),
  recordPulses: vi.fn(),
  touchDeviceLastSeen: vi.fn(),
  enforceRateLimit: vi.fn(),
  broadcastPulsesChanged: vi.fn()
}));

vi.mock("@/lib/meter-devices", () => ({
  authenticateDeviceKey: mocks.authenticateDeviceKey,
  isLiveMeterEnabledForDevice: mocks.isLiveMeterEnabledForDevice,
  recordPulses: mocks.recordPulses,
  touchDeviceLastSeen: mocks.touchDeviceLastSeen
}));
vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: mocks.enforceRateLimit,
  getRateLimitIdentifier: (id: string, scope: string) => `${id}:${scope}`,
  rateLimitHeaders: () => ({})
}));
vi.mock("@/lib/live/broadcast", () => ({ broadcastPulsesChanged: mocks.broadcastPulsesChanged }));

import { POST } from "./route";

const device = {
  id: "device-a",
  connectionId: "connection-a",
  ownerUserId: "user-a",
  name: "Home meter",
  enabled: true,
  pulsesPerKwh: 1000
};
const bootId = "11111111-1111-4111-8111-111111111111";

function post(body: unknown, headers: Record<string, string> = { authorization: "Bearer nm_dev_test" }) {
  return POST(
    new Request("http://localhost/api/live/pulses", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body)
    })
  );
}

const validPulse = { seq: 148, timestampMs: 1786127342184, uptimeMs: 97142, deltaMs: 1803 };

describe("POST /api/live/pulses", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticateDeviceKey.mockResolvedValue(device);
    mocks.isLiveMeterEnabledForDevice.mockResolvedValue(true);
    mocks.enforceRateLimit.mockResolvedValue({ allowed: true, minute: {}, day: {} });
    mocks.recordPulses.mockResolvedValue({ accepted: 1, duplicates: 0 });
    mocks.touchDeviceLastSeen.mockResolvedValue(undefined);
    mocks.broadcastPulsesChanged.mockResolvedValue(undefined);
  });

  describe("realtime broadcast", () => {
    it("sends exactly one broadcast for an accepted batch (never one per pulse)", async () => {
      mocks.recordPulses.mockResolvedValue({ accepted: 5, duplicates: 0 });
      await post({ bootId, pulses: [validPulse, { ...validPulse, seq: 149 }] });
      expect(mocks.broadcastPulsesChanged).toHaveBeenCalledTimes(1);
      expect(mocks.broadcastPulsesChanged).toHaveBeenCalledWith("user-a", 5);
    });

    it("does not broadcast when nothing new was accepted (duplicate-only retry)", async () => {
      mocks.recordPulses.mockResolvedValue({ accepted: 0, duplicates: 2 });
      const response = await post({ bootId, pulses: [validPulse] });
      expect(response.status).toBe(200);
      expect(mocks.broadcastPulsesChanged).not.toHaveBeenCalled();
    });

    it("still returns success (200) if the broadcast rejects -- persistence is durable", async () => {
      mocks.broadcastPulsesChanged.mockRejectedValue(new Error("realtime down"));
      const response = await post({ bootId, pulses: [validPulse] });
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ accepted: 1, duplicates: 0 });
    });
  });

  describe("authentication", () => {
    it("returns 401 when the device cannot be authenticated", async () => {
      mocks.authenticateDeviceKey.mockResolvedValue(null);
      const response = await post({ bootId, pulses: [validPulse] }, {});
      expect(response.status).toBe(401);
      expect(mocks.recordPulses).not.toHaveBeenCalled();
    });

    it("returns 401 for an unknown/disabled key (same generic response)", async () => {
      mocks.authenticateDeviceKey.mockResolvedValue(null);
      const response = await post({ bootId, pulses: [validPulse] });
      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({ message: "Unauthorized." });
    });

    it("passes the Authorization header to authenticateDeviceKey", async () => {
      await post({ bootId, pulses: [validPulse] }, { authorization: "Bearer nm_dev_abc" });
      expect(mocks.authenticateDeviceKey).toHaveBeenCalledWith("Bearer nm_dev_abc");
    });
  });

  describe("feature gate", () => {
    it("returns 403 when the device owner does not have the live-meter feature enabled", async () => {
      mocks.isLiveMeterEnabledForDevice.mockResolvedValue(false);
      const response = await post({ bootId, pulses: [validPulse] });
      expect(response.status).toBe(403);
      expect(mocks.recordPulses).not.toHaveBeenCalled();
    });
  });

  describe("transient server errors (distinct from client errors)", () => {
    it("returns 503 (not 401) when device authentication throws, e.g. DB down", async () => {
      mocks.authenticateDeviceKey.mockRejectedValue(new Error("connection refused"));
      const response = await post({ bootId, pulses: [validPulse] });
      expect(response.status).toBe(503);
      expect(mocks.recordPulses).not.toHaveBeenCalled();
    });

    it("returns 503 when the feature/rate-limit check throws", async () => {
      mocks.isLiveMeterEnabledForDevice.mockRejectedValue(new Error("permissions read failed"));
      const response = await post({ bootId, pulses: [validPulse] });
      expect(response.status).toBe(503);
      expect(mocks.recordPulses).not.toHaveBeenCalled();
    });
  });

  describe("rate limiting", () => {
    it("keys the dedicated meter policy by device id", async () => {
      await post({ bootId, pulses: [validPulse] });
      expect(mocks.enforceRateLimit).toHaveBeenCalledWith("device-a:meter", "meter");
    });

    it("returns 429 when the device exceeds its limit", async () => {
      mocks.enforceRateLimit.mockResolvedValue({ allowed: false, minute: {}, day: {} });
      const response = await post({ bootId, pulses: [validPulse] });
      expect(response.status).toBe(429);
      expect(mocks.recordPulses).not.toHaveBeenCalled();
    });
  });

  describe("validation", () => {
    it("returns 400 for invalid JSON", async () => {
      const response = await post("{not json");
      expect(response.status).toBe(400);
    });

    it("returns 400 for a non-uuid bootId", async () => {
      const response = await post({ bootId: "not-a-uuid", pulses: [validPulse] });
      expect(response.status).toBe(400);
    });

    it("returns 400 for an empty batch", async () => {
      const response = await post({ bootId, pulses: [] });
      expect(response.status).toBe(400);
    });

    it("returns 400 for an oversized batch (> 100)", async () => {
      const pulses = Array.from({ length: 101 }, (_, i) => ({ ...validPulse, seq: i }));
      const response = await post({ bootId, pulses });
      expect(response.status).toBe(400);
    });

    it("returns 400 for a negative seq", async () => {
      const response = await post({ bootId, pulses: [{ ...validPulse, seq: -1 }] });
      expect(response.status).toBe(400);
    });

    it("returns 400 for a non-integer uptime", async () => {
      const response = await post({ bootId, pulses: [{ ...validPulse, uptimeMs: 1.5 }] });
      expect(response.status).toBe(400);
    });

    it("returns 400 for an implausibly future timestamp", async () => {
      const future = Date.now() + 1000 * 60 * 60 * 24 * 30; // 30 days ahead
      const response = await post({ bootId, pulses: [{ ...validPulse, timestampMs: future }] });
      expect(response.status).toBe(400);
      expect(mocks.recordPulses).not.toHaveBeenCalled();
    });

    it("accepts old buffered timestamps (never rejected for being in the past)", async () => {
      const old = Date.UTC(2024, 0, 1);
      const response = await post({ bootId, pulses: [{ ...validPulse, timestampMs: old }] });
      expect(response.status).toBe(200);
    });

    it("defaults a missing deltaMs to null", async () => {
      const { deltaMs: _omit, ...noDelta } = validPulse;
      const response = await post({ bootId, pulses: [noDelta] });
      expect(response.status).toBe(200);
    });
  });

  describe("storage", () => {
    it("stores pulses under the authenticated device, ignoring any body-supplied ids", async () => {
      await post({ bootId, deviceId: "device-EVIL", connectionId: "connection-EVIL", pulses: [validPulse] });
      expect(mocks.recordPulses).toHaveBeenCalledWith("device-a", bootId, [
        expect.objectContaining({ seq: 148, timestampMs: 1786127342184, uptimeMs: 97142, deltaMs: 1803 })
      ]);
    });

    it("stamps last_seen_at only after a successful store", async () => {
      await post({ bootId, pulses: [validPulse] });
      expect(mocks.touchDeviceLastSeen).toHaveBeenCalledWith("device-a");
    });

    it("does not stamp last_seen_at when storage fails, and returns 500", async () => {
      mocks.recordPulses.mockRejectedValue(new Error("db down"));
      const response = await post({ bootId, pulses: [validPulse] });
      expect(response.status).toBe(500);
      expect(mocks.touchDeviceLastSeen).not.toHaveBeenCalled();
    });

    it("returns the accepted/duplicates summary from recordPulses", async () => {
      mocks.recordPulses.mockResolvedValue({ accepted: 4, duplicates: 1 });
      const response = await post({ bootId, pulses: [validPulse] });
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ accepted: 4, duplicates: 1 });
    });
  });
});
