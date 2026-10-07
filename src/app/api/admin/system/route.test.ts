import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), snapshot: vi.fn(), rate: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireAdminSession: mocks.auth }));
vi.mock("@/lib/system-map/data", () => ({ getSystemMapSnapshot: mocks.snapshot }));
vi.mock("@/lib/rate-limit", () => ({ limitUserRequest: mocks.rate }));
import { GET } from "./route";

describe("GET /api/admin/system", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.auth.mockResolvedValue({ ok: true, session: { userId: "admin" } });
    mocks.rate.mockResolvedValue({ response: null, headers: {} });
  });
  it.each([401, 403])("denies non-admin requests before reading data (%s)", async (status) => {
    mocks.auth.mockResolvedValue({ ok: false, status });
    const response = await GET();
    expect(response.status).toBe(status);
    expect(mocks.snapshot).not.toHaveBeenCalled();
    expect(mocks.rate).not.toHaveBeenCalled();
  });
  it("uses a polling-appropriate rate limit and prevents response caching", async () => {
    mocks.snapshot.mockResolvedValue({ generatedAt: "now", nodes: {}, edges: {} });
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mocks.rate).toHaveBeenCalledWith("admin", "admin-system", "systemMap");
  });
  it("honors the rate limiter without querying health", async () => {
    mocks.rate.mockResolvedValue({ response: NextResponse.json({}, { status: 429 }) });
    expect((await GET()).status).toBe(429);
    expect(mocks.snapshot).not.toHaveBeenCalled();
  });
  it("returns a retryable error without backend error details", async () => {
    mocks.snapshot.mockRejectedValue(new Error("secret query details"));
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("secret");
  });
});
