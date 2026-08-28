import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  enforceRateLimit: vi.fn(),
  recordFunnelEvent: vi.fn()
}));

vi.mock("@/lib/funnel", async () => {
  const actual = await vi.importActual<typeof import("@/lib/funnel")>("@/lib/funnel");
  return { ...actual, recordFunnelEvent: mocks.recordFunnelEvent };
});
vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: mocks.enforceRateLimit,
  getRateLimitIdentifier: (id: string, scope: string) => `${id}:${scope}`,
  getTrustedRequestIp: () => "203.0.113.7",
  rateLimitHeaders: () => ({})
}));

import { POST } from "./route";

function request(body: unknown) {
  return new Request("http://localhost/api/funnel/track", {
    method: "POST",
    body: JSON.stringify(body)
  });
}

describe("POST /api/funnel/track", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.enforceRateLimit.mockResolvedValue({ allowed: true, minute: {}, day: {} });
  });

  it("records an allow-listed client-trackable event", async () => {
    const response = await POST(request({ event: "sign_in_started" }));
    expect(response.status).toBe(204);
    expect(mocks.recordFunnelEvent).toHaveBeenCalledWith("sign_in_started");
  });

  it("silently no-ops (204, no crash) for a valid-but-not-client-trackable event", async () => {
    const response = await POST(request({ event: "connect_succeeded" }));
    expect(response.status).toBe(204);
    expect(mocks.recordFunnelEvent).not.toHaveBeenCalled();
  });

  it("silently no-ops for an invalid event name instead of erroring", async () => {
    const response = await POST(request({ event: "not_a_real_event" }));
    expect(response.status).toBe(204);
    expect(mocks.recordFunnelEvent).not.toHaveBeenCalled();
  });

  it("is rate limited by IP", async () => {
    mocks.enforceRateLimit.mockResolvedValue({ allowed: false, minute: {}, day: {} });
    const response = await POST(request({ event: "sign_in_started" }));
    expect(response.status).toBe(429);
    expect(mocks.recordFunnelEvent).not.toHaveBeenCalled();
  });
});
