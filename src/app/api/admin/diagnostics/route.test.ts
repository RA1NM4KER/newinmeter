import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireAdminSession: vi.fn(), getSnapshot: vi.fn(), resolved: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireAdminSession: mocks.requireAdminSession }));
vi.mock("@/lib/diagnostics/data", () => ({ getDiagnosticsSnapshot: mocks.getSnapshot }));

vi.mock("@/lib/diagnostics/store", () => ({
  listRecentResolvedSystemEvents: mocks.resolved,
  sanitizeDiagnosticMessage: (value: string) => value
}));

import { GET } from "./route";

describe("GET /api/admin/diagnostics", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([401, 403] as const)("enforces server-side admin authorization (%s)", async (status) => {
    mocks.requireAdminSession.mockResolvedValue({ ok: false, status });
    const response = await GET(new Request("https://newinmeter.vercel.app/api/admin/diagnostics"));
    expect(response.status).toBe(status);
    expect(mocks.getSnapshot).not.toHaveBeenCalled();
  });

  it("returns diagnostics only after the admin guard succeeds", async () => {
    mocks.requireAdminSession.mockResolvedValue({ ok: true, session: { userId: "admin" } });
    mocks.getSnapshot.mockResolvedValue({ generatedAt: "now", overview: {}, connections: [], events: [] });
    const response = await GET(new Request("https://newinmeter.vercel.app/api/admin/diagnostics"));
    expect(response.status).toBe(200);
    expect(mocks.getSnapshot).toHaveBeenCalledTimes(1);
  });
});

it("limits detail loads to validated connection IDs and skips overview work", async () => {
  mocks.requireAdminSession.mockResolvedValue({ ok: true, session: { userId: "admin" } });
  mocks.getSnapshot.mockResolvedValue({ connections: [{ id: "connection" }] });
  const id = "91d3023a-770f-4c23-b8fc-436aa1278695";
  const response = await GET(
    new Request(`https://newinmeter.vercel.app/api/admin/diagnostics?section=connections&ids=${id}`)
  );
  expect(await response.json()).toEqual([{ id: "connection" }]);
  expect(mocks.getSnapshot).toHaveBeenLastCalledWith(expect.any(Date), { connectionIds: [id], overview: false });
});
it("rejects malformed connection filters", async () => {
  mocks.requireAdminSession.mockResolvedValue({ ok: true, session: { userId: "admin" } });
  const response = await GET(
    new Request("https://newinmeter.vercel.app/api/admin/diagnostics?section=connections&ids=bad")
  );
  expect(response.status).toBe(400);
});
it("loads resolved events without constructing a diagnostics snapshot", async () => {
  vi.clearAllMocks();
  mocks.requireAdminSession.mockResolvedValue({ ok: true, session: { userId: "admin" } });
  mocks.resolved.mockResolvedValue([]);
  const response = await GET(new Request("https://newinmeter.vercel.app/api/admin/diagnostics?section=resolved"));
  expect(await response.json()).toEqual([]);
  expect(mocks.getSnapshot).not.toHaveBeenCalled();
});

it("loads healthy-list summaries without their hidden histories", async () => {
  mocks.requireAdminSession.mockResolvedValue({ ok: true, session: { userId: "admin" } });
  mocks.getSnapshot.mockResolvedValue({ connections: [] });
  const id = "91d3023a-770f-4c23-b8fc-436aa1278695";
  await GET(
    new Request(`https://newinmeter.vercel.app/api/admin/diagnostics?section=connections&ids=${id}&details=false`)
  );
  expect(mocks.getSnapshot).toHaveBeenLastCalledWith(expect.any(Date), {
    connectionIds: [id],
    overview: false,
    details: false
  });
});

it("returns only status and timestamp for the navigation indicator", async () => {
  mocks.requireAdminSession.mockResolvedValue({ ok: true, session: { userId: "admin" } });
  mocks.getSnapshot.mockResolvedValue({
    generatedAt: "2026-10-13T12:00:00Z",
    overview: { overall: "healthy" },
    connections: [{ id: "private" }],
    events: []
  });
  const response = await GET(new Request("https://newinmeter.vercel.app/api/admin/diagnostics?section=health"));
  expect(await response.json()).toEqual({ health: "healthy", checkedAt: "2026-10-13T12:00:00Z" });
  expect(mocks.getSnapshot).toHaveBeenLastCalledWith(expect.any(Date), { details: false, indicator: true });
});
