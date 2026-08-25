"use client";

import { Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Heart, ShieldCheck, Smartphone, type LucideIcon } from "lucide-react";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { usePwaInstall } from "@/components/pwa/pwa-install-provider";
import { AssistantDialog } from "@/components/assistant/assistant-dialog";
import { AssistantProvider } from "@/components/assistant/assistant-provider";
import { DayDetailProvider } from "@/components/assistant/day-detail-provider";
import { ACTIVITIES_TAB_CHANGE_EVENT } from "@/lib/activity/tab-event";
import { SUPPORT_MAILTO } from "@/lib/site-config";
import { BottomNav } from "./bottom-nav";
import { NotificationBell } from "./notification-bell";
import { NotificationProvider } from "./notification-provider";
import { PushNotificationProvider } from "./push-notification-provider";
import { SidebarNav } from "./sidebar-nav";
import { TopBar } from "./top-bar";
import { Wordmark } from "./wordmark";
import type { AppShellProps } from "./types";

function SignOutForm({ compact = false }: { compact?: boolean }) {
  return (
    <form action="/auth/sign-out" className={compact ? "shrink-0" : undefined} method="post">
      <button
        type="submit"
        className={
          compact
            ? "text-sm font-medium text-ink transition hover:text-brandTeal"
            : "text-xs text-muted transition hover:text-ink"
        }
      >
        Sign out
      </button>
    </form>
  );
}

// Shared row style for every plain icon+label link in the sidebar footer and
// the mobile "More" sheet (Admin, Install app, Buy me a coffee) -- one
// component instead of three near-identical ones means they can't drift out
// of alignment with each other the way SidebarNav's circle-badge treatment
// (built for the main nav list) did when reused here for just Admin.
function MenuLink({
  href,
  icon: Icon,
  label,
  external,
  onClick,
  sheet = false
}: {
  href: string;
  icon: LucideIcon;
  label: string;
  external?: boolean;
  onClick?: () => void;
  sheet?: boolean;
}) {
  return (
    <Link
      className={
        sheet
          ? "flex min-h-12 items-center gap-3 rounded-lg px-3 py-2 text-[0.9375rem] text-muted transition hover:bg-canvas hover:text-ink"
          : "flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted transition hover:bg-canvas hover:text-ink"
      }
      href={href}
      onClick={onClick}
      rel={external ? "noreferrer" : undefined}
      target={external ? "_blank" : undefined}
    >
      <Icon aria-hidden="true" className={sheet ? "h-5 w-5" : "h-4 w-4"} />
      {label}
    </Link>
  );
}

// Isolated in its own Suspense boundary so useSearchParams() (which opts a
// tree out of static generation) can't affect callers that render AppShell
// on a static page, like /offline.
function ActivitiesTableTabDetector({ onChange }: { onChange: (isTableTab: boolean) => void }) {
  // Covers a real navigation landing on /activities?tab=table (direct link,
  // reload, browser back/forward).
  const searchParams = useSearchParams();

  useEffect(() => {
    onChange(searchParams.get("tab") === "table");
  }, [searchParams, onChange]);

  // Covers a client-side tab click, which updates the URL via
  // history.replaceState directly and so never touches useSearchParams --
  // see ACTIVITIES_TAB_CHANGE_EVENT.
  useEffect(() => {
    const handleTabChange = (event: Event) => {
      onChange((event as CustomEvent<"dashboard" | "table">).detail === "table");
    };
    window.addEventListener(ACTIVITIES_TAB_CHANGE_EVENT, handleTabChange);
    return () => window.removeEventListener(ACTIVITIES_TAB_CHANGE_EVENT, handleTabChange);
  }, [onChange]);

  return null;
}

function DemoBadge() {
  return (
    <span className="inline-flex w-fit items-center rounded-full border border-accent/30 bg-accentSoft px-2 py-0.5 text-[0.6875rem] font-medium text-brandTeal dark:text-accent">
      Demo account · synthetic data
    </span>
  );
}

export function AppShell({
  children,
  userEmail,
  isAdmin = false,
  isActivitiesEnabled = false,
  isLiveMeterEnabled = false,
  isAiAssistantEnabled = false,
  isAlertsEnabled = false,
  isDemo = false,
  initialUnreadNotificationCount = 0
}: AppShellProps) {
  const { isStandalone } = usePwaInstall();
  const [isNavOpen, setIsNavOpen] = useState(false);
  const [isActivitiesTableTab, setIsActivitiesTableTab] = useState(false);
  const [isHeaderHidden, setIsHeaderHidden] = useState(false);
  const pathname = usePathname();
  const lockViewport =
    pathname === "/data" || pathname === "/admin" || (pathname === "/activities" && isActivitiesTableTab);
  // Data, Admin users, and the Activities Table tab go edge-to-edge and
  // borderless below lg; each table restores its floating card shell at lg+.
  const isFullBleedTable =
    pathname === "/data" || pathname === "/admin" || (pathname === "/activities" && isActivitiesTableTab);

  // Mobile header rolls away on scroll-down, back on scroll-up. Two possible
  // scroll sources feed the same delta logic below: <main> itself (lockViewport
  // pages, which delegate real scrolling to their own nested region, so main
  // never actually scrolls and this source never fires -- the header just
  // stays put, which is the right no-op for them) and the window/document
  // (regular pages, which let the document itself scroll so iOS Safari's own
  // toolbar can collapse -- see the main className comment below). Only one
  // of the two ever fires meaningfully for a given page, so no lockViewport
  // branching is needed in the handling itself.
  const mainRef = useRef<HTMLElement>(null);
  const lastScrollTopRef = useRef(0);
  const mainTickingRef = useRef(false);
  const windowTickingRef = useRef(false);

  const applyScrollDelta = (scrollTop: number) => {
    const delta = scrollTop - lastScrollTopRef.current;

    if (scrollTop < 16) {
      setIsHeaderHidden(false);
    } else if (delta > 8) {
      setIsHeaderHidden(true);
    } else if (delta < -8) {
      setIsHeaderHidden(false);
    }

    lastScrollTopRef.current = scrollTop;
  };

  // useLayoutEffect, not useEffect: this has to run before paint, or the
  // new page would flash at the old page's leftover scroll position for a
  // frame before snapping to 0.
  useLayoutEffect(() => {
    // <main> never unmounts across a client-side navigation (only children
    // does) -- its scrollTop (lockViewport pages) or the window's own
    // scroll position (regular pages) otherwise carries straight over from
    // whatever page was open before. Resetting the ref without also
    // resetting the real scroll position left a stale scrollTop that the
    // very next scroll event would diff against 0, producing a large
    // spurious "scrolled down" delta that re-hid the header the instant it
    // landed.
    if (mainRef.current) {
      mainRef.current.scrollTop = 0;
    }
    window.scrollTo(0, 0);
    setIsHeaderHidden(false);
    lastScrollTopRef.current = 0;
  }, [pathname]);

  // Switching the Activities tab doesn't change pathname, so a header
  // hidden while scrolled down on the Dashboard tab (regular/window-scroll)
  // wouldn't otherwise reset when landing on the Table tab (lockViewport),
  // leaving no scroll-up gesture to bring it back.
  useLayoutEffect(() => {
    if (lockViewport) {
      if (mainRef.current) {
        mainRef.current.scrollTop = 0;
      }
      window.scrollTo(0, 0);
      setIsHeaderHidden(false);
      lastScrollTopRef.current = 0;
    }
  }, [lockViewport]);

  const handleMainScroll = () => {
    if (mainTickingRef.current) {
      return;
    }
    mainTickingRef.current = true;
    requestAnimationFrame(() => {
      applyScrollDelta(mainRef.current?.scrollTop ?? 0);
      mainTickingRef.current = false;
    });
  };

  // Regular pages: the document itself is the scrolling element (see the
  // outer shell/main className comments), so this is the source that
  // actually fires for them. Harmless no-op for lockViewport pages, where
  // the shell keeps document scroll clipped and window.scrollY never moves.
  useEffect(() => {
    const handleWindowScroll = () => {
      if (windowTickingRef.current) {
        return;
      }
      windowTickingRef.current = true;
      requestAnimationFrame(() => {
        applyScrollDelta(window.scrollY);
        windowTickingRef.current = false;
      });
    };

    window.addEventListener("scroll", handleWindowScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleWindowScroll);
  }, []);

  return (
    <AssistantProvider
      isActivitiesEnabled={isActivitiesEnabled}
      isAlertsEnabled={isAlertsEnabled}
      isDemo={isDemo}
      isEnabled={isAiAssistantEnabled}
    >
      <DayDetailProvider activitiesEnabled={isActivitiesEnabled}>
        <NotificationProvider initialUnreadCount={initialUnreadNotificationCount}>
          <PushNotificationProvider>
            {/* lockViewport pages keep the original fixed-height, internally-
        scrolling shell (nothing here may scroll except the nested region
        those pages manage themselves) -- sized with 100dvh (the *actual*
        current viewport), not 100svh (the smallest the viewport could get
        if mobile browser chrome fully expanded). svh is right for content
        that has to keep working while chrome is showing, but this shell has
        no chrome to reserve space for once it's a standalone/installed PWA
        -- and on iOS specifically, svh can read stale/undersized right
        after first launching a freshly installed PWA (before the OS has
        settled on the real fullscreen viewport), leaving a phantom gap
        below BottomNav that only clears on a full relaunch. dvh tracks the
        real visible viewport instead, so it's correct immediately.
        Regular pages instead let the document itself grow/scroll --
        min-h-[100svh] (not a fixed height, and deliberately still svh, not
        dvh: for a *min-height* on a page real users scroll, svh is the
        conservative floor that stays satisfied even while chrome is
        expanded, whereas dvh here would flicker the page shorter every
        time chrome re-expands mid-scroll) so short pages still fill the
        viewport, but without overflow-hidden clipping the document's own
        scroll, which is what lets iOS Safari's toolbar/address bar
        collapse on scroll like any normal page. */}
            <div className={`flex ${lockViewport ? "h-[100dvh] overflow-hidden" : "min-h-[100svh]"}`}>
              {pathname === "/activities" ? (
                <Suspense fallback={null}>
                  <ActivitiesTableTabDetector onChange={setIsActivitiesTableTab} />
                </Suspense>
              ) : null}
              <aside className="hidden w-64 shrink-0 flex-col bg-sidebar lg:sticky lg:top-0 lg:flex lg:h-[100dvh] lg:self-start">
                <div className="flex h-16 shrink-0 items-center justify-between px-6">
                  <Link href="/">
                    <Wordmark className="text-2xl" textClassName="text-ink" accentClassName="text-accent" />
                  </Link>
                  <NotificationBell />
                </div>
                <div className="min-h-0 flex-1 px-3">
                  <SidebarNav
                    isAdmin={isAdmin}
                    isActivitiesEnabled={isActivitiesEnabled}
                    isLiveMeterEnabled={isLiveMeterEnabled}
                  />
                </div>
                <div className="shrink-0 px-3 pb-3">
                  {isStandalone ? null : <MenuLink href="/install" icon={Smartphone} label="Install app" />}
                  <MenuLink external href="https://ko-fi.com/kefasaleck" icon={Heart} label="Buy me a coffee" />
                </div>
                <div className="shrink-0 border-t border-line px-4 py-4">
                  {isDemo ? (
                    <div className="mb-2">
                      <DemoBadge />
                    </div>
                  ) : null}
                  <div className="flex items-center gap-2">
                    {userEmail ? (
                      <p className="min-w-0 max-w-[9.5rem] truncate text-xs text-muted">{userEmail}</p>
                    ) : null}
                    <SignOutForm />
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <Link className="text-xs text-muted transition hover:text-ink" href="/privacy">
                      Privacy
                    </Link>
                    <Link className="text-xs text-muted transition hover:text-ink" href="/terms">
                      Terms
                    </Link>
                    <a className="text-xs text-muted transition hover:text-ink" href={SUPPORT_MAILTO}>
                      Feedback
                    </a>
                  </div>
                </div>
              </aside>

              <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                <TopBar
                  className="fixed inset-x-0 top-0 z-20 lg:hidden"
                  hidden={isHeaderHidden}
                  right={<NotificationBell />}
                />

                {/* lockViewport pages (data table, admin users table, activities
            table tab) keep the original internal-scroll architecture: main
            itself stays non-scrolling and those pages delegate scrolling to
            a nested region so their own header/toolbar/footer can stay
            pinned too, with BottomNav sized into the fixed-height flex
            column below (no manual bottom padding needed).
            Regular pages instead let the document itself scroll (see the
            outer shell's own comment for why) -- main is just normal block
            flow here, and BottomNav becomes a fixed viewport overlay
            instead of a flex sibling, so pb-24 clears it on mobile
            (dropped at lg, where the bottom nav doesn't render at all).
            Either way the mobile header is `fixed` (out of flow, so it can
            roll away on scroll without leaving a gap), so pt-14 recreates
            the space it used to occupy in-flow -- dropped again at lg
            since the header doesn't render there at all. */}
                <main
                  className={`mx-auto flex w-full max-w-7xl flex-1 flex-col px-3 pt-14 sm:px-6 lg:px-8 lg:pt-0 ${
                    lockViewport
                      ? isFullBleedTable
                        ? // Data, Admin users, and Activities' Table tab go full-bleed/edge-to-edge
                          // below lg (/data has its own internal footer row for
                          // bottom padding there; activities' table has none by
                          // design, running flush to the bottom nav). At lg+ each is
                          // back to a normal rounded, bordered, margined card -- same
                          // "floating" treatment as every other card on the page --
                          // so it wants the same
                          // bottom breathing room those get, restored via lg:pb-5.
                          "min-h-0 overflow-hidden lg:pb-5"
                        : // Any future locked, non-table page keeps normal mobile
                          // bottom breathing room.
                          "min-h-0 overflow-hidden pb-5"
                      : "pb-24 lg:pb-5"
                  }`}
                  onScroll={handleMainScroll}
                  ref={mainRef}
                >
                  {children}
                </main>

                <BottomNav
                  isAdmin={isAdmin}
                  isActivitiesEnabled={isActivitiesEnabled}
                  isLiveMeterEnabled={isLiveMeterEnabled}
                  onOpenMenu={() => setIsNavOpen(true)}
                  overlay={!lockViewport}
                />
              </div>

              <BottomSheet contentPadding="compact" isOpen={isNavOpen} onClose={() => setIsNavOpen(false)} title="Menu">
                <div className="flex flex-col gap-0.5">
                  {isAdmin ? (
                    <MenuLink
                      href="/admin"
                      icon={ShieldCheck}
                      label="Admin"
                      onClick={() => setIsNavOpen(false)}
                      sheet
                    />
                  ) : null}
                  {isStandalone ? null : (
                    <MenuLink
                      href="/install"
                      icon={Smartphone}
                      label="Install app"
                      onClick={() => setIsNavOpen(false)}
                      sheet
                    />
                  )}
                  <MenuLink
                    external
                    href="https://ko-fi.com/kefasaleck"
                    icon={Heart}
                    label="Buy me a coffee"
                    onClick={() => setIsNavOpen(false)}
                    sheet
                  />
                  <div className="mt-2 border-t border-line pt-3.5">
                    {isDemo ? (
                      <div className="mb-2">
                        <DemoBadge />
                      </div>
                    ) : null}
                    <div className="flex min-h-10 w-full items-center justify-between gap-4">
                      {userEmail ? <p className="min-w-0 truncate text-sm text-muted">{userEmail}</p> : null}
                      <SignOutForm compact />
                    </div>
                    <div className="mt-1 flex items-center gap-4 whitespace-nowrap">
                      <Link className="text-xs text-muted transition hover:text-ink" href="/privacy">
                        Privacy
                      </Link>
                      <Link className="text-xs text-muted transition hover:text-ink" href="/terms">
                        Terms
                      </Link>
                      <a className="text-xs text-muted transition hover:text-ink" href={SUPPORT_MAILTO}>
                        Feedback
                      </a>
                    </div>
                  </div>
                </div>
              </BottomSheet>
            </div>
            {isAiAssistantEnabled ? <AssistantDialog /> : null}
          </PushNotificationProvider>
        </NotificationProvider>
      </DayDetailProvider>
    </AssistantProvider>
  );
}
