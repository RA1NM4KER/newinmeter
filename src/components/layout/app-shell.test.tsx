// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

const mocks = vi.hoisted(() => ({
  usePathname: vi.fn(),
  useSearchParams: vi.fn(),
  useRouter: vi.fn(),
  usePwaInstall: vi.fn()
}));

vi.mock("next/navigation", () => ({
  usePathname: mocks.usePathname,
  useSearchParams: mocks.useSearchParams,
  useRouter: mocks.useRouter
}));
vi.mock("@/components/pwa/pwa-install-provider", () => ({
  usePwaInstall: mocks.usePwaInstall
}));
// AppShell only renders these providers/consumers for their side effects
// (data fetching, matchMedia listeners, etc.) which this layout-focused
// test isn't exercising -- stubbed to plain passthroughs so the assertions
// below stay about the shell's own DOM structure, not its notification
// plumbing (already covered by those modules' own tests).
vi.mock("@/components/layout/notification-provider", () => ({
  NotificationProvider: ({ children }: { children: ReactNode }) => children,
  useNotificationCentre: () => ({
    unreadCount: 0,
    notifications: [],
    listLoading: false,
    markingAllRead: false,
    isDesktop: false,
    hasEnabledAlerts: null,
    ensureLoaded: () => undefined,
    refresh: () => undefined,
    markOneRead: async () => undefined,
    markAllRead: async () => undefined
  })
}));
vi.mock("@/components/layout/push-notification-provider", () => ({
  PushNotificationProvider: ({ children }: { children: ReactNode }) => children,
  useDeviceNotifications: () => ({
    browserPermission: "unsupported",
    subscriptionActive: false,
    checking: false,
    enableDeviceNotifications: async () => ({ status: "unsupported" as const }),
    disableDeviceNotifications: async () => undefined,
    refreshDeviceNotificationState: async () => undefined
  })
}));
// Same reasoning as the providers above -- DayDetailProvider's own
// react-query fetch/dialog wiring isn't what this layout-focused test
// exercises, and it needs a real QueryClientProvider ancestor that this
// shell-only test intentionally doesn't set up.
vi.mock("@/components/assistant/day-detail-provider", () => ({
  DayDetailProvider: ({ children }: { children: ReactNode }) => children
}));

import { AppShell } from "./app-shell";

function setPathname(pathname: string) {
  mocks.usePathname.mockReturnValue(pathname);
  mocks.useSearchParams.mockReturnValue(new URLSearchParams());
}

describe("AppShell viewport-height architecture", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.usePwaInstall.mockReturnValue({ isStandalone: false });
    mocks.useRouter.mockReturnValue({ push: vi.fn() });
  });

  it("/data (lockViewport): fixed-height shell uses 100dvh, not 100svh -- the actual visible viewport, not the smallest one mobile chrome could force", () => {
    setPathname("/data");
    const { container } = render(<AppShell>content</AppShell>);

    const shell = container.firstElementChild as HTMLElement;
    expect(shell.className).toContain("h-[100dvh]");
    expect(shell.className).toContain("overflow-hidden");
    expect(shell.className).not.toContain("100svh");
  });

  it("/admin (lockViewport): same fixed-height 100dvh shell", () => {
    setPathname("/admin");
    const { container } = render(<AppShell>content</AppShell>);

    const shell = container.firstElementChild as HTMLElement;
    expect(shell.className).toContain("h-[100dvh]");
    expect(shell.className).not.toContain("100svh");
  });

  it("/admin uses the full-bleed table main spacing below lg and restores bottom spacing at lg", () => {
    setPathname("/admin");
    const { container } = render(<AppShell>content</AppShell>);

    const main = container.querySelector("main") as HTMLElement;
    const classes = main.className.split(/\s+/);
    expect(classes).toContain("lg:pb-5");
    expect(classes).not.toContain("pb-5");
  });

  it("mobile menu uses substantial rows and a full-width account row without changing shared sidebar sizing", () => {
    setPathname("/admin");
    const { container } = render(
      <AppShell isAdmin userEmail="a-very-long-email-address@example.com">
        content
      </AppShell>
    );

    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
    const dialog = screen.getByRole("dialog");
    const menu = within(dialog);
    expect(menu.getByRole("heading", { name: "Menu" })).toBeTruthy();
    const adminLink = menu.getByRole("link", { name: "Admin" });
    const accountRow = menu.getByText("a-very-long-email-address@example.com").parentElement as HTMLElement;

    expect(adminLink.className).toContain("min-h-12");
    expect(adminLink.className).toContain("text-[0.9375rem]");
    expect(adminLink.querySelector("svg")?.getAttribute("class")).toContain("h-5");
    expect(accountRow.className).toContain("justify-between");
    expect(menu.getByRole("button", { name: "Sign out" }).className).toContain("font-medium");

    const sidebarAdminLink = within(container.querySelector("aside") as HTMLElement).getByRole("link", {
      name: "Admin"
    });
    expect(sidebarAdminLink.className).toContain("text-sm");
    expect(sidebarAdminLink.className).not.toContain("min-h-12");
  });

  it("regular pages (document-scrolling): shell is not fixed-height/overflow-hidden, and its min-height stays svh (the conservative floor for a page real users scroll)", () => {
    setPathname("/");
    const { container } = render(<AppShell>content</AppShell>);

    const shell = container.firstElementChild as HTMLElement;
    expect(shell.className).toContain("min-h-[100svh]");
    expect(shell.className).not.toContain("h-[100dvh]");
    expect(shell.className).not.toContain("overflow-hidden");
  });

  it("desktop sidebar uses 100dvh for its sticky full-height sizing, consistent with the locked shell", () => {
    setPathname("/data");
    const { container } = render(<AppShell>content</AppShell>);

    const aside = container.querySelector("aside") as HTMLElement;
    expect(aside.className).toContain("lg:h-[100dvh]");
    expect(aside.className).not.toContain("100svh");
  });
});
