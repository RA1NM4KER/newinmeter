// @vitest-environment jsdom
import { cleanup, render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PwaInstallProvider, usePwaInstall } from "./pwa-install-provider";

function installMatchMedia(standaloneMatches: boolean) {
  const listeners: Array<() => void> = [];
  const mql = {
    matches: standaloneMatches,
    media: "(display-mode: standalone)",
    addEventListener: (_event: string, listener: () => void) => listeners.push(listener),
    removeEventListener: vi.fn()
  };
  window.matchMedia = vi.fn().mockReturnValue(mql);
  return { mql, fireChange: () => listeners.forEach((listener) => listener()) };
}

function setUserAgent(ua: string) {
  Object.defineProperty(window.navigator, "userAgent", { value: ua, configurable: true });
}

function setPlatform(platform: string, maxTouchPoints = 0) {
  Object.defineProperty(window.navigator, "platform", { value: platform, configurable: true });
  Object.defineProperty(window.navigator, "maxTouchPoints", { value: maxTouchPoints, configurable: true });
}

function setIosStandaloneFlag(value: boolean | undefined) {
  Object.defineProperty(window.navigator, "standalone", { value, configurable: true });
}

function Probe() {
  const { ready, isStandalone, isIos, isMobile, platform, canPromptInstall, promptInstall } = usePwaInstall();
  return (
    <div>
      <span data-testid="ready">{String(ready)}</span>
      <span data-testid="standalone">{String(isStandalone)}</span>
      <span data-testid="ios">{String(isIos)}</span>
      <span data-testid="mobile">{String(isMobile)}</span>
      <span data-testid="platform">{platform}</span>
      <span data-testid="can-prompt">{String(canPromptInstall)}</span>
      <button onClick={() => void promptInstall()}>prompt-install</button>
    </div>
  );
}

const originalUserAgent = window.navigator.userAgent;
const originalPlatform = window.navigator.platform;

describe("PwaInstallProvider", () => {
  afterEach(() => {
    cleanup();
    setUserAgent(originalUserAgent);
    setPlatform(originalPlatform);
    setIosStandaloneFlag(undefined);
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    installMatchMedia(false);
    setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64)");
    setPlatform("Win32");
  });

  it("reports not-standalone by default, then ready after mount", async () => {
    render(
      <PwaInstallProvider>
        <Probe />
      </PwaInstallProvider>
    );

    await waitFor(() => expect(screen.getByTestId("ready").textContent).toBe("true"));
    expect(screen.getByTestId("standalone").textContent).toBe("false");
  });

  it("detects standalone via display-mode media query", async () => {
    installMatchMedia(true);
    render(
      <PwaInstallProvider>
        <Probe />
      </PwaInstallProvider>
    );

    await waitFor(() => expect(screen.getByTestId("standalone").textContent).toBe("true"));
  });

  it("detects iOS standalone via navigator.standalone even when the media query doesn't match", async () => {
    installMatchMedia(false);
    setIosStandaloneFlag(true);
    render(
      <PwaInstallProvider>
        <Probe />
      </PwaInstallProvider>
    );

    await waitFor(() => expect(screen.getByTestId("standalone").textContent).toBe("true"));
  });

  it("detects iOS from an iPhone user agent", async () => {
    setUserAgent(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
    );
    render(
      <PwaInstallProvider>
        <Probe />
      </PwaInstallProvider>
    );

    await waitFor(() => expect(screen.getByTestId("ios").textContent).toBe("true"));
    expect(screen.getByTestId("mobile").textContent).toBe("true");
    expect(screen.getByTestId("platform").textContent).toBe("ios");
  });

  it("detects iPadOS masquerading as a Mac via touch points", async () => {
    setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_6) AppleWebKit/605.1.15 (KHTML, like Gecko)");
    setPlatform("MacIntel", 5);
    render(
      <PwaInstallProvider>
        <Probe />
      </PwaInstallProvider>
    );

    await waitFor(() => expect(screen.getByTestId("ios").textContent).toBe("true"));
  });

  it("does not misdetect a real Mac (no touch points) as iOS", async () => {
    setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_6) AppleWebKit/605.1.15 (KHTML, like Gecko)");
    setPlatform("MacIntel", 0);
    render(
      <PwaInstallProvider>
        <Probe />
      </PwaInstallProvider>
    );

    await waitFor(() => expect(screen.getByTestId("ready").textContent).toBe("true"));
    expect(screen.getByTestId("ios").textContent).toBe("false");
    expect(screen.getByTestId("platform").textContent).toBe("desktop");
  });

  it("captures beforeinstallprompt, preventing its default UI, and exposes canPromptInstall", async () => {
    render(
      <PwaInstallProvider>
        <Probe />
      </PwaInstallProvider>
    );
    await waitFor(() => expect(screen.getByTestId("ready").textContent).toBe("true"));

    const preventDefault = vi.fn();
    act(() => {
      const event = new Event("beforeinstallprompt", { cancelable: true });
      Object.defineProperty(event, "preventDefault", { value: preventDefault });
      window.dispatchEvent(event);
    });

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("can-prompt").textContent).toBe("true");
  });

  it("promptInstall() invokes the retained event and clears it after use", async () => {
    render(
      <PwaInstallProvider>
        <Probe />
      </PwaInstallProvider>
    );
    await waitFor(() => expect(screen.getByTestId("ready").textContent).toBe("true"));

    const prompt = vi.fn();
    const userChoice = Promise.resolve({ outcome: "accepted" as const, platform: "web" });
    act(() => {
      const event = new Event("beforeinstallprompt", { cancelable: true });
      Object.defineProperty(event, "preventDefault", { value: vi.fn() });
      Object.defineProperty(event, "prompt", { value: prompt });
      Object.defineProperty(event, "userChoice", { value: userChoice });
      window.dispatchEvent(event);
    });
    await waitFor(() => expect(screen.getByTestId("can-prompt").textContent).toBe("true"));

    fireEvent.click(screen.getByText("prompt-install"));

    await waitFor(() => expect(prompt).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId("can-prompt").textContent).toBe("false"));
  });

  it("appinstalled flips isStandalone and clears canPromptInstall without needing a reload", async () => {
    render(
      <PwaInstallProvider>
        <Probe />
      </PwaInstallProvider>
    );
    await waitFor(() => expect(screen.getByTestId("ready").textContent).toBe("true"));

    act(() => {
      const event = new Event("beforeinstallprompt", { cancelable: true });
      Object.defineProperty(event, "preventDefault", { value: vi.fn() });
      window.dispatchEvent(event);
    });
    await waitFor(() => expect(screen.getByTestId("can-prompt").textContent).toBe("true"));

    act(() => {
      window.dispatchEvent(new Event("appinstalled"));
    });

    expect(screen.getByTestId("standalone").textContent).toBe("true");
    expect(screen.getByTestId("can-prompt").textContent).toBe("false");
  });

  it("usePwaInstall() outside a provider returns safe no-op defaults instead of throwing", () => {
    render(<Probe />);
    expect(screen.getByTestId("ready").textContent).toBe("false");
    expect(screen.getByTestId("standalone").textContent).toBe("false");
  });
});
