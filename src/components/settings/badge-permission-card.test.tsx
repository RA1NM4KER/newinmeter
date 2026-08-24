// @vitest-environment jsdom
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  useDeviceNotifications: vi.fn(),
  enableDeviceNotifications: vi.fn(),
  disableDeviceNotifications: vi.fn(),
  usePwaInstall: vi.fn(),
  openInstallGuide: vi.fn()
}));

vi.mock("@/components/layout/push-notification-provider", () => ({
  useDeviceNotifications: mocks.useDeviceNotifications
}));
vi.mock("@/components/pwa/pwa-install-provider", () => ({
  usePwaInstall: mocks.usePwaInstall
}));

import { BadgePermissionCard } from "./badge-permission-card";

function setDeviceNotifications(overrides: Partial<{ browserPermission: string; subscriptionActive: boolean; checking: boolean }> = {}) {
  mocks.useDeviceNotifications.mockReturnValue({
    browserPermission: "granted",
    subscriptionActive: false,
    checking: false,
    enableDeviceNotifications: mocks.enableDeviceNotifications,
    disableDeviceNotifications: mocks.disableDeviceNotifications,
    refreshDeviceNotificationState: vi.fn(),
    ...overrides
  });
}

function setPwaInstall(overrides: Partial<{ isIos: boolean; isStandalone: boolean }> = {}) {
  mocks.usePwaInstall.mockReturnValue({
    ready: true,
    isStandalone: false,
    isIos: false,
    isMobile: false,
    platform: "desktop",
    canPromptInstall: false,
    promptInstall: vi.fn(),
    isInstallGuideOpen: false,
    openInstallGuide: mocks.openInstallGuide,
    closeInstallGuide: vi.fn(),
    ...overrides
  });
}

describe("BadgePermissionCard", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.enableDeviceNotifications.mockResolvedValue({ status: "granted" });
    mocks.disableDeviceNotifications.mockResolvedValue(undefined);
    setPwaInstall();
  });

  it("renders nothing when the platform is unsupported", () => {
    setDeviceNotifications({ browserPermission: "unsupported" });
    const { container } = render(<BadgePermissionCard />);
    expect(container.firstChild).toBeNull();
  });

  it("iOS browser, not installed: shows a setup action instead of disappearing", () => {
    setPwaInstall({ isIos: true, isStandalone: false });
    setDeviceNotifications({ browserPermission: "unsupported" });
    render(<BadgePermissionCard />);

    expect(screen.getByText("Notifications")).toBeDefined();
    fireEvent.click(screen.getByText("Set up"));
    expect(mocks.openInstallGuide).toHaveBeenCalledTimes(1);
  });

  it("iOS, installed (standalone) but genuinely unsupported: still renders nothing", () => {
    setPwaInstall({ isIos: true, isStandalone: true });
    setDeviceNotifications({ browserPermission: "unsupported" });
    const { container } = render(<BadgePermissionCard />);
    expect(container.firstChild).toBeNull();
  });

  it("reflects subscriptionActive as ON -- not browserPermission alone", async () => {
    setDeviceNotifications({ browserPermission: "granted", subscriptionActive: true });
    render(<BadgePermissionCard />);
    expect(screen.getByLabelText("Notifications").getAttribute("aria-checked")).toBe("true");
    // ON means "NewinMeter is configured to push to this device", not "the
    // OS will definitely deliver it" -- the copy says so explicitly rather
    // than implying certainty about a system-level toggle NewinMeter can't
    // reliably read (notably on iOS).
    expect(screen.queryByText(/Your device settings can still block delivery/i)).not.toBeNull();
  });

  it("shows OFF when permission is granted but there's no active subscription -- the core bug fix", () => {
    setDeviceNotifications({ browserPermission: "granted", subscriptionActive: false });
    render(<BadgePermissionCard />);
    expect(screen.getByLabelText("Notifications").getAttribute("aria-checked")).toBe("false");
    expect(screen.queryByText(/NewinMeter won't send push notifications to this device/i)).not.toBeNull();
  });

  it("disables the toggle and explains when permission is denied, without offering a broken Enable action", () => {
    setDeviceNotifications({ browserPermission: "denied", subscriptionActive: false });
    render(<BadgePermissionCard />);

    expect((screen.getByLabelText("Notifications") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText(/blocked for this device/i)).not.toBeNull();
  });

  it("turning the toggle on calls enableDeviceNotifications", async () => {
    setDeviceNotifications({ browserPermission: "granted", subscriptionActive: false });
    render(<BadgePermissionCard />);

    fireEvent.click(screen.getByLabelText("Notifications"));

    await waitFor(() => expect(mocks.enableDeviceNotifications).toHaveBeenCalledTimes(1));
  });

  it("turning the toggle off calls disableDeviceNotifications, which is the shared unsubscribe path", async () => {
    setDeviceNotifications({ browserPermission: "granted", subscriptionActive: true });
    render(<BadgePermissionCard />);

    fireEvent.click(screen.getByLabelText("Notifications"));

    await waitFor(() => expect(mocks.disableDeviceNotifications).toHaveBeenCalledTimes(1));
  });
});
