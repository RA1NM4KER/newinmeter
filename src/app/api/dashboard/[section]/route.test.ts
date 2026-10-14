import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  rate: vi.fn(),
  summary: vi.fn(),
  daily: vi.fn(),
  hourly: vi.fn(),
  features: vi.fn(),
  rules: vi.fn(),
  adoption: vi.fn(),
  rates: vi.fn()
}));
vi.mock("@/lib/auth/session", () => ({ requireConnectedSession: mocks.auth }));
vi.mock("@/lib/rate-limit", () => ({ limitUserRequest: mocks.rate }));
vi.mock("@/lib/dashboard-data", () => ({
  loadDashboardSummary: mocks.summary,
  loadDashboardDailyRollups: mocks.daily,
  loadDashboardHourlyRollups: mocks.hourly
}));
vi.mock("@/lib/features", () => ({ getUserFeatureAccessDetailed: mocks.features }));
vi.mock("@/lib/newinmeter/alerts", () => ({ getAlertRulesForUser: mocks.rules }));
vi.mock("@/lib/newinmeter/feature-adoption", () => ({
  getFeatureAdoption: mocks.adoption,
  getFeatureAdoptionRates: mocks.rates
}));
import { GET } from "./route";
const get = (section: string) =>
  GET(new Request(`https://example.com/api/dashboard/${section}`), { params: { section } });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({
    ok: true,
    session: { userId: "user-a", accessToken: "user-token", connection: { id: "connection-a" } }
  });
  mocks.rate.mockResolvedValue({ response: null, headers: {} });
  mocks.summary.mockResolvedValue({ latestBalance: 300 });
  mocks.daily.mockResolvedValue([]);
  mocks.hourly.mockResolvedValue([]);
  mocks.features.mockResolvedValue({
    alerts: { enabled: false },
    ai: { enabled: false },
    activities: { enabled: false }
  });
  mocks.rates.mockResolvedValue({});
});
describe("dashboard resource route", () => {
  it.each([401, 409])("rejects unavailable sessions (%i) before any data read", async (status) => {
    mocks.auth.mockResolvedValue({ ok: false, status });
    expect((await get("daily")).status).toBe(status);
    expect(mocks.daily).not.toHaveBeenCalled();
    expect(mocks.rate).not.toHaveBeenCalled();
  });
  it("rejects unknown resources", async () => expect((await get("everything")).status).toBe(400));
  it("preserves rate limiting", async () => {
    mocks.rate.mockResolvedValue({ response: new Response(null, { status: 429 }) });
    expect((await get("summary")).status).toBe(429);
    expect(mocks.summary).not.toHaveBeenCalled();
  });
  it.each(["summary", "daily", "hourly"])("loads only %s, using the caller token", async (section) => {
    expect((await get(section)).status).toBe(200);
    const loaders = { summary: mocks.summary, daily: mocks.daily, hourly: mocks.hourly };
    expect(loaders[section as keyof typeof loaders]).toHaveBeenCalledWith("user-token");
    for (const [key, loader] of Object.entries(loaders)) if (key !== section) expect(loader).not.toHaveBeenCalled();
    expect(mocks.features).not.toHaveBeenCalled();
  });
  it("omits gated prompt reads when features are disabled", async () => {
    const response = await get("prompts");
    expect(response.status).toBe(200);
    expect(mocks.rules).not.toHaveBeenCalled();
    expect(mocks.adoption).not.toHaveBeenCalled();
  });
  it("returns a safe section failure without raw upstream errors", async () => {
    mocks.hourly.mockRejectedValue(new Error("private upstream details"));
    const response = await get("hourly");
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ message: "Unable to load this dashboard section." });
  });
});
