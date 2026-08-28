import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  exchangeCodeForSession: vi.fn(),
  recordFunnelEvent: vi.fn()
}));

vi.mock("@/lib/supabase/server-client", () => ({
  createServerSupabaseClient: () => ({ auth: { exchangeCodeForSession: mocks.exchangeCodeForSession } })
}));
vi.mock("@/lib/funnel", () => ({ recordFunnelEvent: mocks.recordFunnelEvent }));

import { GET } from "./route";

describe("GET /auth/callback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects home and records sign_in_completed on a successful code exchange", async () => {
    mocks.exchangeCodeForSession.mockResolvedValue({ error: null });

    const response = await GET(new Request("http://localhost/auth/callback?code=abc123"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/");
    expect(mocks.recordFunnelEvent).toHaveBeenCalledWith("sign_in_completed");
  });

  it("still redirects, but does not record completion, when the code exchange fails", async () => {
    mocks.exchangeCodeForSession.mockResolvedValue({ error: { message: "invalid code" } });

    const response = await GET(new Request("http://localhost/auth/callback?code=bad"));

    expect(response.status).toBe(307);
    expect(mocks.recordFunnelEvent).not.toHaveBeenCalled();
  });

  it("redirects without touching Supabase when no code is present", async () => {
    const response = await GET(new Request("http://localhost/auth/callback"));

    expect(response.headers.get("location")).toBe("http://localhost/");
    expect(mocks.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(mocks.recordFunnelEvent).not.toHaveBeenCalled();
  });
});
