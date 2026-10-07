import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), snapshot: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireAdminSession: mocks.auth }));
vi.mock("@/lib/system-map/data", () => ({ getSystemMapSnapshot: mocks.snapshot }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  }
}));
import AdminSystemPage from "./page";

describe("admin system page", () => {
  beforeEach(() => vi.resetAllMocks());
  it.each([401, 403])("denies unauthorized page requests (%s)", async (status) => {
    mocks.auth.mockResolvedValue({ ok: false, status });
    await expect(AdminSystemPage()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.snapshot).not.toHaveBeenCalled();
  });
  it("allows the client to retry a failed initial read", async () => {
    mocks.auth.mockResolvedValue({ ok: true });
    mocks.snapshot.mockRejectedValue(new Error("unavailable"));
    expect((await AdminSystemPage()).props.initialSnapshot).toBeNull();
  });
});
