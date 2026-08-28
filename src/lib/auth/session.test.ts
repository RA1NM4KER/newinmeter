import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getClaims: vi.fn()
}));

vi.mock("@/lib/supabase/server-client", () => ({
  createServerSupabaseClient: () => ({
    auth: { getSession: mocks.getSession, getClaims: mocks.getClaims }
  })
}));
// React's cache() requires the React 19 implementation unavailable outside
// Next's own bundler with the installed react@18.3.1 -- same stub used by
// other server-module tests in this repo (see e.g.
// src/lib/newinmeter/connection.test.ts).
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return { ...actual, cache: <T>(fn: T) => fn };
});

import { getAuthenticatedSession } from "./session";

describe("getAuthenticatedSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns null, without warning, when there is simply no session cookie -- an ordinary anonymous visit", async () => {
    mocks.getSession.mockResolvedValue({ data: { session: null } });
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await getAuthenticatedSession();

    expect(result).toBeNull();
    expect(mocks.getClaims).not.toHaveBeenCalled();
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it("resolves the caller's identity from valid claims", async () => {
    mocks.getSession.mockResolvedValue({ data: { session: { access_token: "token-abc" } } });
    mocks.getClaims.mockResolvedValue({
      data: { claims: { sub: "user-a", email: "a@example.com" } },
      error: null
    });

    const result = await getAuthenticatedSession();

    expect(result).toEqual({ userId: "user-a", email: "a@example.com", accessToken: "token-abc" });
  });

  it("returns null and logs a distinct, message-only warning when claims verification fails (session cookie existed but was invalid)", async () => {
    mocks.getSession.mockResolvedValue({ data: { session: { access_token: "token-abc" } } });
    mocks.getClaims.mockResolvedValue({ data: null, error: { message: "jwt expired" } });
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await getAuthenticatedSession();

    expect(result).toBeNull();
    expect(consoleSpy).toHaveBeenCalledWith("auth_session_claims_failed", { message: "jwt expired" });
  });

  it("never logs the token itself, on any path", async () => {
    mocks.getSession.mockResolvedValue({ data: { session: { access_token: "super-secret-token-value" } } });
    mocks.getClaims.mockResolvedValue({ data: null, error: { message: "jwt expired" } });
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await getAuthenticatedSession();

    const loggedText = consoleSpy.mock.calls.flat(2).join(" ");
    expect(loggedText).not.toContain("super-secret-token-value");
  });
});
