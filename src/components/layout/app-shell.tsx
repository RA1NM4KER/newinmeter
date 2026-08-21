"use client";

import { Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Heart, ShieldCheck, Smartphone, type LucideIcon } from "lucide-react";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { SUPPORT_MAILTO } from "@/lib/site-config";
import { BottomNav } from "./bottom-nav";
import { SidebarNav } from "./sidebar-nav";
import { Wordmark } from "./wordmark";
import type { AppShellProps } from "./types";

function SignOutForm() {
  return (
    <form action="/auth/sign-out" method="post">
      <button type="submit" className="text-xs text-muted transition hover:text-ink">
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
  onClick
}: {
  href: string;
  icon: LucideIcon;
  label: string;
  external?: boolean;
  onClick?: () => void;
}) {
  return (
    <Link
      className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted transition hover:bg-canvas hover:text-ink"
      href={href}
      onClick={onClick}
      rel={external ? "noreferrer" : undefined}
      target={external ? "_blank" : undefined}
    >
      <Icon aria-hidden="true" className="h-4 w-4" />
      {label}
    </Link>
  );
}

// Isolated in its own Suspense boundary so useSearchParams() (which opts a
// tree out of static generation) can't affect callers that render AppShell
// on a static page, like /offline.
function ActivitiesTableTabDetector({ onChange }: { onChange: (isTableTab: boolean) => void }) {
  const searchParams = useSearchParams();

  useEffect(() => {
    onChange(searchParams.get("tab") === "table");
  }, [searchParams, onChange]);

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
  isDemo = false
}: AppShellProps) {
  const [isNavOpen, setIsNavOpen] = useState(false);
  const [isActivitiesTableTab, setIsActivitiesTableTab] = useState(false);
  const [isHeaderHidden, setIsHeaderHidden] = useState(false);
  const pathname = usePathname();
  const lockViewport =
    pathname === "/data" || pathname === "/admin" || (pathname === "/activities" && isActivitiesTableTab);
  // Of the lockViewport pages, only /data goes edge-to-edge/borderless on
  // mobile (see data-table.tsx) -- admin's and activities' tables stay a
  // normal rounded, margined card at every width, so they need the usual
  // bottom breathing room on mobile too, not just at lg+.
  const isFullBleedTable = pathname === "/data";

  // Mobile header rolls away on scroll-down, back on scroll-up -- only ever
  // fires for pages where <main> itself scrolls (lockViewport pages delegate
  // scrolling to their own nested region instead, so main never scrolls
  // there and the header just stays put, which is the right no-op for them).
  const mainRef = useRef<HTMLElement>(null);
  const lastScrollTopRef = useRef(0);
  const tickingRef = useRef(false);

  // useLayoutEffect, not useEffect: this has to run before paint, or the
  // new page would flash at the old page's leftover scroll position for a
  // frame before snapping to 0.
  useLayoutEffect(() => {
    // <main> never unmounts across a client-side navigation (only children
    // does) -- its scrollTop otherwise carries straight over from whatever
    // page was open before. Resetting the ref without also resetting the
    // real scroll position left a stale scrollTop that the very next scroll
    // event would diff against 0, producing a large spurious "scrolled
    // down" delta that re-hid the header the instant it landed.
    if (mainRef.current) {
      mainRef.current.scrollTop = 0;
    }
    setIsHeaderHidden(false);
    lastScrollTopRef.current = 0;
  }, [pathname]);

  // Switching the Activities tab doesn't change pathname, so a header
  // hidden while scrolled down on the Dashboard tab wouldn't otherwise
  // reset when landing on the Table tab -- which is lockViewport (main
  // doesn't scroll there), leaving no scroll-up gesture to bring it back.
  useLayoutEffect(() => {
    if (lockViewport) {
      if (mainRef.current) {
        mainRef.current.scrollTop = 0;
      }
      setIsHeaderHidden(false);
      lastScrollTopRef.current = 0;
    }
  }, [lockViewport]);

  const handleMainScroll = () => {
    if (tickingRef.current) {
      return;
    }
    tickingRef.current = true;
    requestAnimationFrame(() => {
      const scrollTop = mainRef.current?.scrollTop ?? 0;
      const delta = scrollTop - lastScrollTopRef.current;

      if (scrollTop < 16) {
        setIsHeaderHidden(false);
      } else if (delta > 8) {
        setIsHeaderHidden(true);
      } else if (delta < -8) {
        setIsHeaderHidden(false);
      }

      lastScrollTopRef.current = scrollTop;
      tickingRef.current = false;
    });
  };

  return (
    <div className="flex h-[100svh] overflow-hidden">
      {pathname === "/activities" ? (
        <Suspense fallback={null}>
          <ActivitiesTableTabDetector onChange={setIsActivitiesTableTab} />
        </Suspense>
      ) : null}
      <aside className="hidden w-64 shrink-0 flex-col bg-sidebar lg:flex">
        <div className="flex h-16 shrink-0 items-center px-6">
          <Link href="/">
            <Wordmark className="text-2xl" textClassName="text-ink" accentClassName="text-accent" />
          </Link>
        </div>
        <div className="min-h-0 flex-1 px-3">
          <SidebarNav
            isAdmin={isAdmin}
            isActivitiesEnabled={isActivitiesEnabled}
            isLiveMeterEnabled={isLiveMeterEnabled}
          />
        </div>
        <div className="shrink-0 px-3 pb-3">
          <MenuLink href="/install" icon={Smartphone} label="Install app" />
          <MenuLink external href="https://ko-fi.com/kefasaleck" icon={Heart} label="Buy me a coffee" />
        </div>
        <div className="shrink-0 border-t border-line px-4 py-4">
          {isDemo ? (
            <div className="mb-2">
              <DemoBadge />
            </div>
          ) : null}
          <div className="flex items-center gap-2">
            {userEmail ? <p className="min-w-0 max-w-[9.5rem] truncate text-xs text-muted">{userEmail}</p> : null}
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
        <header
          className={`fixed inset-x-0 top-0 z-20 flex h-14 items-center border-b border-line bg-canvas px-4 transition-transform duration-200 motion-reduce:transition-none lg:hidden ${
            isHeaderHidden ? "-translate-y-full" : "translate-y-0"
          }`}
        >
          <Link href="/">
            <Wordmark className="text-base" textClassName="text-ink" accentClassName="text-accent" />
          </Link>
        </header>

        {/* The shell itself never scrolls -- the sidebar must stay put.
            Regular pages scroll their own content here; lockViewport pages
            (data table, admin users table, activities table tab) instead
            delegate scrolling to a nested region so their own
            header/toolbar/footer can stay pinned too. The mobile header is
            `fixed` (out of flow, so it can roll away on scroll without
            leaving a gap), so pt-14 recreates the space it used to occupy
            in-flow -- dropped again at lg since the header doesn't render
            there at all. */}
        <main
          className={`mx-auto flex w-full max-w-7xl flex-1 flex-col px-3 pt-14 sm:px-6 lg:px-8 lg:pt-0 ${
            lockViewport
              ? isFullBleedTable
                ? // /data goes full-bleed/edge-to-edge below lg (own internal
                  // footer row already provides bottom padding there). At lg+
                  // it's back to a normal rounded, bordered, margined card --
                  // same "floating" treatment as every other card on the
                  // page -- so it wants the same bottom breathing room those
                  // get, restored via lg:pb-5.
                  "min-h-0 overflow-hidden lg:pb-5"
                : // Admin/activities' tables stay a margined card at every
                  // width, so they keep the usual pb-5 throughout.
                  "min-h-0 overflow-hidden pb-5"
              : "overflow-y-auto pb-5"
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
        />
      </div>

      <BottomSheet isOpen={isNavOpen} onClose={() => setIsNavOpen(false)} title="Menu">
        <div className="flex flex-col gap-1">
          {isAdmin ? (
            <MenuLink href="/admin" icon={ShieldCheck} label="Admin" onClick={() => setIsNavOpen(false)} />
          ) : null}
          <MenuLink href="/install" icon={Smartphone} label="Install app" onClick={() => setIsNavOpen(false)} />
          <MenuLink
            external
            href="https://ko-fi.com/kefasaleck"
            icon={Heart}
            label="Buy me a coffee"
            onClick={() => setIsNavOpen(false)}
          />
          <div className="border-t border-line pt-4">
            {isDemo ? (
              <div className="mb-2">
                <DemoBadge />
              </div>
            ) : null}
            <div className="flex items-center gap-2">
              {userEmail ? <p className="min-w-0 max-w-[9.5rem] truncate text-xs text-muted">{userEmail}</p> : null}
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
        </div>
      </BottomSheet>
    </div>
  );
}
