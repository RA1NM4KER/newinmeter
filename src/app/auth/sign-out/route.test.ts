import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ signOut: vi.fn() }));

vi.mock("@/lib/supabase/server-client", () => ({
  createServerSupabaseClient: () => ({ auth: { signOut: mocks.signOut } })
}));

import { POST } from "./route";

describe("POST /auth/sign-out", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.signOut.mockResolvedValue({ error: null });
  });

  it("signs out the Supabase session and redirects to /login", async () => {
    const response = await POST(new Request("http://localhost/auth/sign-out", { method: "POST" }));

    expect(mocks.signOut).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/login");
  });
});
