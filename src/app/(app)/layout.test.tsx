// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

const mocks = vi.hoisted(() => ({
  getAuthenticatedSession: vi.fn(),
  getConnectionForUser: vi.fn(),
  getUserFeatureAccessDetailed: vi.fn(),
  getUnreadNotificationCount: vi.fn(),
  getOrCreateUserPermissions: vi.fn(),
  redirect: vi.fn()
}));

vi.mock("@/lib/auth/session", () => ({ getAuthenticatedSession: mocks.getAuthenticatedSession }));
vi.mock("@/lib/newinmeter/connection", () => ({ getConnectionForUser: mocks.getConnectionForUser }));
vi.mock("@/lib/features", () => ({ getUserFeatureAccessDetailed: mocks.getUserFeatureAccessDetailed }));
vi.mock("@/lib/newinmeter/alerts", () => ({ getUnreadNotificationCount: mocks.getUnreadNotificationCount }));
vi.mock("@/lib/user-roles", () => ({ getOrCreateUserPermissions: mocks.getOrCreateUserPermissions }));
// AppShell's own dependency graph (notification/push providers, assistant
// dialog, etc.) is exercised by app-shell.test.tsx -- this test only cares
// whether the layout reaches AppShell at all, and with what props.
vi.mock("@/components/layout/app-shell", () => ({
  AppShell: (props: { children: ReactNode; isAdmin?: boolean; isDemo?: boolean }) => (
    <div data-testid="app-shell" data-is-admin={String(props.isAdmin)} data-is-demo={String(props.isDemo)}>
      {props.children}
    </div>
  )
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    mocks.redirect(url);
    throw new Error(`NEXT_REDIRECT:${url}`);
  }
}));

import AppGroupLayout from "./layout";

const connectedConnection = { status: "connected", isDemo: false };
const session = { userId: "user-a", email: "a@example.com", accessToken: "token" };

describe("(app)/layout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUserFeatureAccessDetailed.mockResolvedValue({
      activities: { enabled: false },
      live: { enabled: false },
      ai: { enabled: false },
      alerts: { enabled: false }
    });
    mocks.getUnreadNotificationCount.mockResolvedValue(0);
    mocks.getOrCreateUserPermissions.mockResolvedValue({ role: "user" });
  });

  afterEach(() => {
    cleanup();
  });

  it("redirects to /login without fetching anything else when there is no session", async () => {
    mocks.getAuthenticatedSession.mockResolvedValue(null);

    await expect(AppGroupLayout({ children: <div /> })).rejects.toThrow("NEXT_REDIRECT:/login");

    expect(mocks.redirect).toHaveBeenCalledWith("/login");
    expect(mocks.getConnectionForUser).not.toHaveBeenCalled();
  });

  it("redirects to /connect when authenticated but not connected", async () => {
    mocks.getAuthenticatedSession.mockResolvedValue(session);
    mocks.getConnectionForUser.mockResolvedValue(null);

    await expect(AppGroupLayout({ children: <div /> })).rejects.toThrow("NEXT_REDIRECT:/connect");
    expect(mocks.redirect).toHaveBeenCalledWith("/connect");
  });

  it("redirects to /connect when connected status is anything other than 'connected'", async () => {
    mocks.getAuthenticatedSession.mockResolvedValue(session);
    mocks.getConnectionForUser.mockResolvedValue({ status: "pending_selection", isDemo: false });

    await expect(AppGroupLayout({ children: <div /> })).rejects.toThrow("NEXT_REDIRECT:/connect");
  });

  it("renders the app shell with the caller's own resolved identity when authenticated and connected", async () => {
    mocks.getAuthenticatedSession.mockResolvedValue(session);
    mocks.getConnectionForUser.mockResolvedValue(connectedConnection);
    mocks.getOrCreateUserPermissions.mockResolvedValue({ role: "admin" });

    const ui = await AppGroupLayout({ children: <div data-testid="page-content" /> });
    render(ui);

    expect(mocks.redirect).not.toHaveBeenCalled();
    const shell = screen.getByTestId("app-shell");
    expect(shell.dataset.isAdmin).toBe("true");
    expect(shell.dataset.isDemo).toBe("false");
    expect(screen.getByTestId("page-content")).toBeDefined();
  });

  it("marks the shell as demo when the connection is the shared is_demo connection", async () => {
    mocks.getAuthenticatedSession.mockResolvedValue(session);
    mocks.getConnectionForUser.mockResolvedValue({ status: "connected", isDemo: true });

    const ui = await AppGroupLayout({ children: <div /> });
    render(ui);

    expect(screen.getByTestId("app-shell").dataset.isDemo).toBe("true");
  });
});
