// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

const mocks = vi.hoisted(() => ({
  getAuthenticatedSession: vi.fn(),
  getConnectionForUser: vi.fn(),
  recordFunnelEvent: vi.fn(),
  redirect: vi.fn()
}));

vi.mock("@/lib/auth/session", () => ({ getAuthenticatedSession: mocks.getAuthenticatedSession }));
vi.mock("@/lib/newinmeter/connection", () => ({ getConnectionForUser: mocks.getConnectionForUser }));
vi.mock("@/lib/funnel", () => ({ recordFunnelEvent: mocks.recordFunnelEvent }));
vi.mock("@/components/auth/auth-shell", () => ({
  AuthShell: ({ children }: { children: ReactNode }) => <div data-testid="auth-shell">{children}</div>
}));
vi.mock("@/components/connect/connect-form", () => ({
  ConnectForm: (props: { defaultEmail: string }) => (
    <div data-testid="connect-form" data-default-email={props.defaultEmail} />
  )
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    mocks.redirect(url);
    throw new Error(`NEXT_REDIRECT:${url}`);
  }
}));

import ConnectPage from "./page";

const session = { userId: "user-a", email: "resident@example.com", accessToken: "token" };

describe("/connect page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("redirects unauthenticated visitors to /login before checking any connection", async () => {
    mocks.getAuthenticatedSession.mockResolvedValue(null);

    await expect(ConnectPage()).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(mocks.redirect).toHaveBeenCalledWith("/login");
    expect(mocks.getConnectionForUser).not.toHaveBeenCalled();
  });

  it("redirects already-connected users to / instead of showing the connect form again", async () => {
    mocks.getAuthenticatedSession.mockResolvedValue(session);
    mocks.getConnectionForUser.mockResolvedValue({ status: "connected" });

    await expect(ConnectPage()).rejects.toThrow("NEXT_REDIRECT:/");
    expect(mocks.redirect).toHaveBeenCalledWith("/");
  });

  it("renders the connect form for an authenticated, not-yet-connected user, and records the funnel view", async () => {
    mocks.getAuthenticatedSession.mockResolvedValue(session);
    mocks.getConnectionForUser.mockResolvedValue(null);

    const ui = await ConnectPage();
    render(ui);

    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(mocks.recordFunnelEvent).toHaveBeenCalledWith("connect_screen_viewed");
    expect(screen.getByTestId("connect-form").dataset.defaultEmail).toBe("resident@example.com");
  });

  it("also renders the connect form (picker) for a pending_selection connection, not a redirect", async () => {
    mocks.getAuthenticatedSession.mockResolvedValue(session);
    mocks.getConnectionForUser.mockResolvedValue({
      status: "pending_selection",
      pendingAccounts: [{ label: "Home" }]
    });

    const ui = await ConnectPage();
    render(ui);

    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});
