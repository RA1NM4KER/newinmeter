import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCronSecret: vi.fn(),
  getNewinmeterDemoEmail: vi.fn(),
  resetDemoAccount: vi.fn()
}));

vi.mock("@/lib/env", () => ({
  getCronSecret: mocks.getCronSecret,
  getNewinmeterDemoEmail: mocks.getNewinmeterDemoEmail
}));
vi.mock("@/lib/demo/reset", () => ({ resetDemoAccount: mocks.resetDemoAccount }));

import { GET } from "./route";

const CRON_SECRET = "test-cron-secret";

function request(headers: Record<string, string> = { authorization: `Bearer ${CRON_SECRET}` }) {
  return new Request("http://localhost/api/cron/reset-demo", { headers });
}

describe("GET /api/cron/reset-demo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCronSecret.mockReturnValue(CRON_SECRET);
    mocks.getNewinmeterDemoEmail.mockReturnValue("demo@newinmeter.app");
  });

  it("rejects requests without the correct cron secret", async () => {
    const response = await GET(request({ authorization: "Bearer wrong" }));
    expect(response.status).toBe(401);
    expect(mocks.resetDemoAccount).not.toHaveBeenCalled();
  });

  it("resets the configured demo account", async () => {
    mocks.resetDemoAccount.mockResolvedValue({
      email: "demo@newinmeter.app",
      userId: "demo-user",
      connectionId: "demo-conn",
      startDate: "2026-06-01",
      endDate: "2026-08-09",
      days: 70,
      energyRows: 3360,
      activities: 42
    });

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(mocks.resetDemoAccount).toHaveBeenCalledWith("demo@newinmeter.app");
    await expect(response.json()).resolves.toMatchObject({ ok: true, energyRows: 3360 });
  });

  it("is a no-op, not an error, when NEWINMETER_DEMO_EMAIL isn't configured", async () => {
    mocks.getNewinmeterDemoEmail.mockReturnValue(undefined);

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(mocks.resetDemoAccount).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({ ok: true });
  });

  it("returns 500 without leaking the underlying error when the reset fails", async () => {
    mocks.resetDemoAccount.mockRejectedValue(new Error("supabase internal detail"));

    const response = await GET(request());

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.message).not.toContain("supabase internal detail");
  });
});
