import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  connection: vi.fn(),
  features: vi.fn(),
  summary: vi.fn(),
  daily: vi.fn(),
  hourly: vi.fn()
}));
vi.mock("@/lib/auth/session", () => ({ getAuthenticatedSession: mocks.session }));
vi.mock("@/lib/newinmeter/connection", () => ({ getConnectionForUser: mocks.connection }));
vi.mock("@/lib/features", () => ({ getUserFeatureAccessDetailed: mocks.features }));
vi.mock("@/lib/dashboard-data", () => ({
  loadDashboardSummary: mocks.summary,
  loadDashboardDailyRollups: mocks.daily,
  loadDashboardHourlyRollups: mocks.hourly
}));
vi.mock("@/components/dashboard/dashboard-shell", () => ({ DashboardShell: () => null }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`);
  }
}));
import Home from "./page";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ userId: "user-a" });
  mocks.connection.mockResolvedValue({ status: "connected", dataState: "warm", lastSyncedAt: "sync-a", isDemo: false });
  mocks.features.mockResolvedValue({
    ai: { enabled: false },
    activities: { enabled: true },
    alerts: { enabled: true }
  });
});
describe("dashboard initial page", () => {
  it("returns the shell without awaiting any dashboard dataset", async () => {
    const element = await Home();
    expect(element?.props).toMatchObject({ userId: "user-a", revision: "sync-a", isActivitiesEnabled: true });
    expect(mocks.summary).not.toHaveBeenCalled();
    expect(mocks.daily).not.toHaveBeenCalled();
    expect(mocks.hourly).not.toHaveBeenCalled();
  });
  it("preserves the login redirect", async () => {
    mocks.session.mockResolvedValue(null);
    await expect(Home()).rejects.toThrow("redirect:/login");
  });
  it("preserves the connection redirect", async () => {
    mocks.connection.mockResolvedValue(null);
    await expect(Home()).rejects.toThrow("redirect:/connect");
  });
  it.each(["cold", "restoring"])("does not render a dashboard for %s data", async (dataState) => {
    mocks.connection.mockResolvedValue({ status: "connected", dataState });
    expect(await Home()).toBeNull();
    expect(mocks.features).not.toHaveBeenCalled();
  });
});
