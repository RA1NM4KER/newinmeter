import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireAdminSession: vi.fn(), getSnapshot: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireAdminSession: mocks.requireAdminSession }));
vi.mock("@/lib/diagnostics/data", () => ({ getDiagnosticsSnapshot: mocks.getSnapshot }));

import { GET } from "./route";

describe("GET /api/admin/diagnostics", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([401, 403] as const)("enforces server-side admin authorization (%s)", async (status) => {
    mocks.requireAdminSession.mockResolvedValue({ ok: false, status });
    const response = await GET();
    expect(response.status).toBe(status);
    expect(mocks.getSnapshot).not.toHaveBeenCalled();
  });

  it("returns diagnostics only after the admin guard succeeds", async () => {
    mocks.requireAdminSession.mockResolvedValue({ ok: true, session: { userId: "admin" } });
    mocks.getSnapshot.mockResolvedValue({ generatedAt: "now", overview: {}, connections: [], events: [] });
    const response = await GET();
    expect(response.status).toBe(200);
    expect(mocks.getSnapshot).toHaveBeenCalledTimes(1);
  });
});
