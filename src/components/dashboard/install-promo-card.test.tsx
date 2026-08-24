// @vitest-environment jsdom
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  usePwaInstall: vi.fn(),
  isInstallPromoCoolingDown: vi.fn(),
  dismissInstallPromo: vi.fn(),
  push: vi.fn(),
  promptInstall: vi.fn(),
  openInstallGuide: vi.fn()
}));

vi.mock("@/components/pwa/pwa-install-provider", () => ({
  usePwaInstall: mocks.usePwaInstall
}));
vi.mock("@/lib/pwa-install-prompt", () => ({
  isInstallPromoCoolingDown: mocks.isInstallPromoCoolingDown,
  dismissInstallPromo: mocks.dismissInstallPromo
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push })
}));

import { InstallPromoCard } from "./install-promo-card";

function setPwaInstall(overrides: Partial<ReturnType<typeof mocks.usePwaInstall>> = {}) {
  mocks.usePwaInstall.mockReturnValue({
    ready: true,
    isStandalone: false,
    isIos: false,
    isMobile: true,
    platform: "android",
    canPromptInstall: false,
    promptInstall: mocks.promptInstall,
    isInstallGuideOpen: false,
    openInstallGuide: mocks.openInstallGuide,
    closeInstallGuide: vi.fn(),
    ...overrides
  });
}

describe("InstallPromoCard", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isInstallPromoCoolingDown.mockReturnValue(false);
    setPwaInstall();
  });

  it("renders on mobile once ready and not cooling down", async () => {
    render(<InstallPromoCard alertsEnabled isDemo={false} />);
    await waitFor(() => expect(screen.getByText("Get NewinMeter alerts on your phone")).toBeDefined());
  });

  it("renders nothing before the client-side ready pass completes", () => {
    setPwaInstall({ ready: false });
    const { container } = render(<InstallPromoCard alertsEnabled isDemo={false} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing once this device is standalone", () => {
    setPwaInstall({ isStandalone: true });
    const { container } = render(<InstallPromoCard alertsEnabled isDemo={false} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing on desktop (mobile-first)", () => {
    setPwaInstall({ isMobile: false });
    const { container } = render(<InstallPromoCard alertsEnabled isDemo={false} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when Alerts access is disabled", () => {
    const { container } = render(<InstallPromoCard alertsEnabled={false} isDemo={false} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing for a demo account", () => {
    const { container } = render(<InstallPromoCard alertsEnabled isDemo />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing while a prior dismissal is still cooling down", () => {
    mocks.isInstallPromoCoolingDown.mockReturnValue(true);
    const { container } = render(<InstallPromoCard alertsEnabled isDemo={false} />);
    expect(container.firstChild).toBeNull();
  });

  it("dismissing sets the cooldown and hides immediately", async () => {
    render(<InstallPromoCard alertsEnabled isDemo={false} />);
    await waitFor(() => expect(screen.getByText("Get NewinMeter alerts on your phone")).toBeDefined());

    fireEvent.click(screen.getByLabelText("Dismiss"));

    expect(mocks.dismissInstallPromo).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Get NewinMeter alerts on your phone")).toBeNull();
  });

  it("iOS: Set up opens the install guide", async () => {
    setPwaInstall({ isIos: true });
    render(<InstallPromoCard alertsEnabled isDemo={false} />);
    await waitFor(() => expect(screen.getByText("Set up")).toBeDefined());

    fireEvent.click(screen.getByText("Set up"));
    expect(mocks.openInstallGuide).toHaveBeenCalledTimes(1);
  });

  it("Android with a deferred prompt: Set up triggers the native install prompt", async () => {
    setPwaInstall({ canPromptInstall: true });
    render(<InstallPromoCard alertsEnabled isDemo={false} />);
    await waitFor(() => expect(screen.getByText("Set up")).toBeDefined());

    fireEvent.click(screen.getByText("Set up"));
    await waitFor(() => expect(mocks.promptInstall).toHaveBeenCalledTimes(1));
  });

  it("no deferred prompt available: Set up falls back to /install", async () => {
    render(<InstallPromoCard alertsEnabled isDemo={false} />);
    await waitFor(() => expect(screen.getByText("Set up")).toBeDefined());

    fireEvent.click(screen.getByText("Set up"));
    expect(mocks.push).toHaveBeenCalledWith("/install");
  });
});
