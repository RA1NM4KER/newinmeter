import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return { ...actual, cache: <T>(fn: T) => fn };
});

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  pages: vi.fn(),
  request: vi.fn(),
  users: vi.fn(),
  features: vi.fn()
}));
vi.mock("./supabase-rest", () => ({
  adminSupabaseFetch: mocks.fetch,
  adminSupabaseFetchAllPages: mocks.pages,
  adminSupabaseRequest: mocks.request
}));
vi.mock("./supabase/admin-client", () => ({
  createSupabaseAdminClient: () => ({ auth: { admin: { listUsers: mocks.users } } })
}));
vi.mock("./features", () => ({ getFeatureAccessForUsers: mocks.features }));
import { listAllUserPermissions } from "./user-roles";

const at = "2026-09-16T10:15:04.101Z";
function connection(id: string, extra = {}) {
  return {
    id,
    user_id: id,
    status: "connected",
    updated_at: at,
    data_state: "warm",
    last_synced_at: null,
    auto_sync_enabled: true,
    next_sync_at: null,
    last_auto_sync_status: null,
    last_auto_sync_at: null,
    ...extra
  };
}
function setup(connections: ReturnType<typeof connection>[], runs: unknown[] = []) {
  mocks.users.mockResolvedValue({
    data: { users: connections.map((c) => ({ id: c.id, email: `${c.id}@example.test`, created_at: at })) },
    error: null
  });
  mocks.fetch.mockImplementation((path: string) => Promise.resolve(path.startsWith("/livemopay") ? connections : []));
  mocks.pages.mockResolvedValue(runs);
  mocks.features.mockResolvedValue(new Map());
  mocks.request.mockResolvedValue([{ connection_id: "paused" }, { connection_id: "cold" }]);
}
describe("admin sync history and lifecycle", () => {
  beforeEach(() => vi.clearAllMocks());
  it("reads paginated capture history so dormant users beyond the first page retain actual run details", async () => {
    setup(
      [connection("cold", { data_state: "cold", last_synced_at: at })],
      [{ connection_id: "cold", status: "success", started_at: at, finished_at: at, rows_synced: 42, error: null }]
    );
    const [user] = await listAllUserPermissions();
    expect(mocks.pages).toHaveBeenCalledWith(expect.stringContaining("order=started_at.desc,id.desc"));
    expect(user).toMatchObject({
      connectionLifecycle: "cold",
      connectionStatus: "connected",
      lastRunStatus: "success",
      lastRunAt: at,
      lastRunRowsSynced: 42
    });
  });
  it("uses preserved successful sync metadata when history is absent, without inventing row counts", async () => {
    setup([connection("cold", { data_state: "cold", last_synced_at: at })]);
    expect((await listAllUserPermissions())[0]).toMatchObject({
      lastRunStatus: "success",
      lastRunAt: at,
      lastRunRowsSynced: null
    });
  });
  it("keeps genuinely never-synced connections empty and uses the inactivity predicate, not sync recency", async () => {
    setup([
      connection("active"),
      connection("paused", { last_synced_at: at }),
      connection("cold", { data_state: "cold" })
    ]);
    const users = await listAllUserPermissions();
    expect(users.find((u) => u.userId === "active")).toMatchObject({
      connectionLifecycle: "active",
      lastRunStatus: null,
      lastRunAt: null
    });
    expect(users.find((u) => u.userId === "paused")?.connectionLifecycle).toBe("paused");
    expect(users.find((u) => u.userId === "cold")?.connectionLifecycle).toBe("cold");
  });
  it("does not hide a failed or running latest attempt behind an earlier successful timestamp", async () => {
    setup(
      [connection("active", { last_synced_at: at })],
      [
        {
          connection_id: "active",
          status: "failed",
          started_at: "2026-10-13T12:00:00Z",
          finished_at: null,
          rows_synced: null,
          error: "Failure"
        }
      ]
    );
    expect((await listAllUserPermissions())[0]).toMatchObject({
      lastRunStatus: "failed",
      lastRunAt: "2026-10-13T12:00:00Z",
      lastRunError: "Failure"
    });
  });
});
