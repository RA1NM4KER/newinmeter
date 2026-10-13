import { beforeEach, expect, it, vi } from "vitest";
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return { ...actual, cache: <T>(fn: T) => fn };
});
const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  count: vi.fn(),
  request: vi.fn(),
  health: vi.fn(),
  recent: vi.fn(),
  unresolved: vi.fn(),
  users: vi.fn(),
  push: vi.fn()
}));
vi.mock("../supabase-rest", () => ({
  adminSupabaseFetch: mocks.fetch,
  adminSupabaseCount: mocks.count,
  adminSupabaseRequest: mocks.request
}));
vi.mock("../user-roles", () => ({ listAllAuthUsers: mocks.users }));
vi.mock("../push-subscriptions", () => ({ countPushSubscriptions: mocks.push }));
vi.mock("./store", () => ({
  getSystemHealthStates: mocks.health,
  listRecentSystemEvents: mocks.recent,
  listUnresolvedSystemEvents: mocks.unresolved,
  sanitizeDiagnosticMessage: (message: string) => message
}));
import { getDiagnosticsSnapshot } from "./data";
const now = new Date("2026-10-13T12:00:00Z");
beforeEach(() => {
  vi.clearAllMocks();
  mocks.fetch.mockImplementation((path: string) =>
    Promise.resolve(
      path.startsWith("/livemopay")
        ? [
            {
              id: "conn",
              user_id: "user",
              status: "connected",
              data_state: "warm",
              connected_at: "2026-10-01T12:00:00Z",
              last_synced_at: now.toISOString(),
              auto_sync_enabled: true,
              next_sync_at: "2026-10-13T13:00:00Z",
              sync_claimed_at: null,
              last_error: null,
              last_auto_sync_status: "success",
              last_auto_sync_at: now.toISOString()
            }
          ]
        : []
    )
  );
  mocks.count.mockResolvedValue(0);
  mocks.request.mockResolvedValue([]);
  mocks.health.mockResolvedValue([]);
  mocks.recent.mockResolvedValue([]);
  mocks.unresolved.mockResolvedValue([]);
  mocks.users.mockResolvedValue([{ userId: "user", email: "user@example.test" }]);
  mocks.push.mockResolvedValue(0);
});
it("keeps health classification while skipping full histories and resolved incidents in the initial summary", async () => {
  const summary = await getDiagnosticsSnapshot(now, { details: false });
  expect(summary.overview.healthyConnections).toBe(1);
  expect(summary.connections[0].recentRuns).toEqual([]);
  expect(mocks.recent).not.toHaveBeenCalled();
  const capturePath = mocks.fetch.mock.calls.find(([path]) => path.startsWith("/capture_runs"))![0];
  expect(capturePath).not.toMatch(/rows_fetched|rows_changed|error/);
  const full = await getDiagnosticsSnapshot(now);
  expect(full.overview).toEqual(summary.overview);
  expect(mocks.recent).toHaveBeenCalled();
});
it("does not fetch global health and incident data for an expanded connection", async () => {
  await getDiagnosticsSnapshot(now, { connectionIds: ["conn"], overview: false });
  expect(mocks.health).not.toHaveBeenCalled();
  expect(mocks.recent).not.toHaveBeenCalled();
  expect(mocks.unresolved).not.toHaveBeenCalled();
  expect(mocks.push).not.toHaveBeenCalled();
  expect(mocks.count).not.toHaveBeenCalled();
  expect(mocks.fetch).toHaveBeenCalledWith(expect.stringContaining("&connection_id=in.(conn)"));
});

it("computes indicator health without Auth users, histories, or incident payloads", async () => {
  mocks.health.mockResolvedValue([
    {
      component: "scheduler:auto-sync",
      status: "healthy",
      lastCheckedAt: now.toISOString(),
      lastSuccessAt: now.toISOString()
    },
    {
      component: "livemopay:canary",
      status: "healthy",
      lastCheckedAt: now.toISOString(),
      lastSuccessAt: now.toISOString()
    }
  ]);
  const indicator = await getDiagnosticsSnapshot(now, { indicator: true });
  expect(indicator.overview.overall).toBe("healthy");
  expect(mocks.users).not.toHaveBeenCalled();
  expect(mocks.recent).not.toHaveBeenCalled();
  expect(mocks.unresolved).not.toHaveBeenCalled();
  expect(mocks.push).not.toHaveBeenCalled();
  expect(mocks.count).toHaveBeenCalledWith("/system_events?select=id&severity=eq.critical&resolved_at=is.null");
  const capturePath = mocks.fetch.mock.calls.find(([path]) => path.startsWith("/capture_runs"))![0];
  expect(capturePath).not.toMatch(/rows_fetched|rows_changed|error/);
  mocks.count.mockResolvedValue(1);
  expect((await getDiagnosticsSnapshot(now, { indicator: true })).overview.overall).toBe("critical");
});
