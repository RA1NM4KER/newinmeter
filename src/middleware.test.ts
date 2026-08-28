import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getClaims: vi.fn(),
  createServerClient: vi.fn()
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: mocks.createServerClient
}));
vi.mock("@/lib/supabase/public-config", () => ({
  getSupabasePublicConfig: () => ({ url: "https://project.supabase.co", anonKey: "anon-key" })
}));

import { middleware } from "./middleware";

function request(pathname: string) {
  return new NextRequest(new URL(pathname, "http://localhost:3000"));
}

describe("middleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    mocks.getClaims.mockResolvedValue({ data: { claims: { sub: "user-a" } }, error: null });
    mocks.createServerClient.mockImplementation(() => ({
      auth: { getClaims: mocks.getClaims }
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Regression test for the actual bug: middleware must never do Supabase
  // auth work just to discover a route didn't need it.
  it.each(["/login", "/privacy", "/terms", "/install", "/splash", "/offline", "/auth/callback", "/auth/sign-out"])(
    "never calls the Supabase auth verifier for the public path %s",
    async (pathname) => {
      await middleware(request(pathname));
      expect(mocks.createServerClient).not.toHaveBeenCalled();
      expect(mocks.getClaims).not.toHaveBeenCalled();
    }
  );

  it.each(["/api/assistant", "/api/livemopay/connect", "/api/demo-login", "/api/cron/reset-demo"])(
    "never calls the Supabase auth verifier for the API path %s -- API routes authenticate themselves",
    async (pathname) => {
      await middleware(request(pathname));
      expect(mocks.createServerClient).not.toHaveBeenCalled();
      expect(mocks.getClaims).not.toHaveBeenCalled();
    }
  );

  it("does call the Supabase auth verifier for a protected page path, for its cookie-refresh side effect only", async () => {
    await middleware(request("/"));
    expect(mocks.getClaims).toHaveBeenCalledTimes(1);
  });

  it("never returns a redirect response for an unauthenticated protected-path request -- authorization is not middleware's job anymore", async () => {
    mocks.getClaims.mockResolvedValue({ data: null, error: { message: "no session" } });

    for (const pathname of ["/", "/admin", "/admin/features", "/admin/engagement", "/settings", "/connect"]) {
      const response = await middleware(request(pathname));
      expect(response.status).not.toBe(307);
      expect(response.status).not.toBe(308);
      expect(response.headers.get("location")).toBeNull();
    }
  });

  it("never returns a redirect response for an authenticated protected-path request either", async () => {
    for (const pathname of ["/", "/admin"]) {
      const response = await middleware(request(pathname));
      expect(response.headers.get("location")).toBeNull();
    }
  });

  it("still returns a normal response when the Supabase call rejects -- a failed refresh must never block the request", async () => {
    mocks.getClaims.mockRejectedValue(new Error("network down"));
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const response = await middleware(request("/"));

    expect(response).toBeDefined();
    expect(response.status).toBe(200);
    expect(consoleSpy).toHaveBeenCalledWith(
      "middleware_session_refresh_failed",
      expect.objectContaining({ pathname: "/", message: "network down" })
    );
    consoleSpy.mockRestore();
  });

  it("bounds a stalled Supabase call instead of hanging the request -- this is the actual timeout fix", async () => {
    vi.useFakeTimers();
    mocks.getClaims.mockReturnValue(new Promise(() => {})); // never resolves
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const responsePromise = middleware(request("/"));
    await vi.advanceTimersByTimeAsync(5000);
    const response = await responsePromise;

    expect(response).toBeDefined();
    expect(response.status).toBe(200);
    expect(consoleSpy).toHaveBeenCalledWith("middleware_session_refresh_timeout", { pathname: "/" });
    consoleSpy.mockRestore();
  });

  it("never logs claims/token/cookie contents on failure", async () => {
    mocks.getClaims.mockRejectedValue(new Error("network down"));
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await middleware(request("/"));

    const loggedText = consoleSpy.mock.calls.flat(2).join(" ");
    expect(loggedText).not.toMatch(/eyJ/); // no JWT-looking string (base64url header starts with "eyJ")
    consoleSpy.mockRestore();
  });
});
