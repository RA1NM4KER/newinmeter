"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { IosInstallGuideSheet } from "./ios-install-guide-sheet";

export type PwaPlatform = "ios" | "android" | "desktop" | "other";

export type InstallPromptOutcome = "accepted" | "dismissed" | "unavailable";

type BeforeInstallPromptEvent = Event & {
  prompt: () => void;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

type PwaInstallState = {
  // False until the first client-side detection pass has run -- consumers
  // that render different UI per platform should treat "not ready" as "don't
  // know yet" rather than flashing a wrong default (matches every other
  // hydration-safe check in this app, e.g. the theme bootstrap script).
  ready: boolean;
  isStandalone: boolean;
  isIos: boolean;
  isMobile: boolean;
  platform: PwaPlatform;
  // True only while a captured beforeinstallprompt event is still usable
  // (Chromium only -- Safari/Firefox never fire it, so this stays false
  // there and callers fall back to openInstallGuide()/manual instructions).
  canPromptInstall: boolean;
  promptInstall: () => Promise<InstallPromptOutcome>;
  isInstallGuideOpen: boolean;
  openInstallGuide: () => void;
  closeInstallGuide: () => void;
};

// Sane no-op defaults so any component can call usePwaInstall() without
// being wrapped in the real provider (keeps every existing component test
// that doesn't care about install state from needing to mock this module
// too) -- real detection only ever happens inside PwaInstallProvider itself.
const defaultState: PwaInstallState = {
  ready: false,
  isStandalone: false,
  isIos: false,
  isMobile: false,
  platform: "other",
  canPromptInstall: false,
  promptInstall: async () => "unavailable",
  isInstallGuideOpen: false,
  openInstallGuide: () => undefined,
  closeInstallGuide: () => undefined
};

const PwaInstallContext = createContext<PwaInstallState>(defaultState);

function detectIsStandalone(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  const displayModeStandalone = window.matchMedia?.("(display-mode: standalone)").matches ?? false;
  // iOS Safari's own (non-standard) signal -- display-mode media query
  // support on iOS is inconsistent across versions, so this is checked in
  // addition to it, not instead of it.
  const iosStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
  return displayModeStandalone || iosStandalone;
}

function detectIsIos(): boolean {
  if (typeof navigator === "undefined") {
    return false;
  }
  const ua = navigator.userAgent;
  if (/iPhone|iPod/.test(ua)) {
    return true;
  }
  if (/iPad/.test(ua)) {
    return true;
  }
  // iPadOS 13+ identifies as "Macintosh" in its UA string by default, but is
  // still a touch device with no mouse -- real Macs report maxTouchPoints 0.
  return navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
}

function detectPlatform(isIos: boolean): PwaPlatform {
  if (isIos) {
    return "ios";
  }
  if (typeof navigator === "undefined") {
    return "other";
  }
  if (/Android/i.test(navigator.userAgent)) {
    return "android";
  }
  if (/Win|Mac|Linux/i.test(navigator.platform || navigator.userAgent)) {
    return "desktop";
  }
  return "other";
}

// Mounted once at the root layout so both the public /install page and the
// whole authenticated app share one source of truth for install state --
// see AppShell/DashboardShell/AlertRuleRow/DeviceNotificationStatus, all of
// which read this instead of their own matchMedia/UA checks.
export function PwaInstallProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [isIos, setIsIos] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [platform, setPlatform] = useState<PwaPlatform>("other");
  const [canPromptInstall, setCanPromptInstall] = useState(false);
  const [isInstallGuideOpen, setIsInstallGuideOpen] = useState(false);
  const deferredPromptRef = useRef<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const ios = detectIsIos();
    const android = typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);
    setIsIos(ios);
    setIsMobile(ios || android);
    setPlatform(detectPlatform(ios));
    setIsStandalone(detectIsStandalone());
    setReady(true);

    const mql = window.matchMedia?.("(display-mode: standalone)");
    const handleChange = () => setIsStandalone(detectIsStandalone());
    mql?.addEventListener?.("change", handleChange);
    return () => mql?.removeEventListener?.("change", handleChange);
  }, []);

  useEffect(() => {
    const handleBeforeInstallPrompt = (event: Event) => {
      // Stops Chromium's default mini-infobar so NewinMeter's own
      // contextual CTA is what triggers installation instead.
      event.preventDefault();
      deferredPromptRef.current = event as BeforeInstallPromptEvent;
      setCanPromptInstall(true);
    };

    const handleAppInstalled = () => {
      deferredPromptRef.current = null;
      setCanPromptInstall(false);
      setIsStandalone(true);
      setIsInstallGuideOpen(false);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  const promptInstall = useCallback(async (): Promise<InstallPromptOutcome> => {
    const event = deferredPromptRef.current;
    if (!event) {
      return "unavailable";
    }
    // Native prompts are single-use -- clear immediately so a second click
    // can't try to reuse an already-consumed event.
    deferredPromptRef.current = null;
    setCanPromptInstall(false);
    event.prompt();
    const choice = await event.userChoice.catch(() => ({ outcome: "dismissed" as const }));
    return choice.outcome;
  }, []);

  const openInstallGuide = useCallback(() => setIsInstallGuideOpen(true), []);
  const closeInstallGuide = useCallback(() => setIsInstallGuideOpen(false), []);

  const value = useMemo<PwaInstallState>(
    () => ({
      ready,
      isStandalone,
      isIos,
      isMobile,
      platform,
      canPromptInstall,
      promptInstall,
      isInstallGuideOpen,
      openInstallGuide,
      closeInstallGuide
    }),
    [ready, isStandalone, isIos, isMobile, platform, canPromptInstall, promptInstall, isInstallGuideOpen, openInstallGuide, closeInstallGuide]
  );

  return (
    <PwaInstallContext.Provider value={value}>
      {children}
      <IosInstallGuideSheet isOpen={isInstallGuideOpen} onClose={closeInstallGuide} />
    </PwaInstallContext.Provider>
  );
}

export function usePwaInstall(): PwaInstallState {
  return useContext(PwaInstallContext);
}
