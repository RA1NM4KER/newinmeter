"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Heart, Menu, Smartphone } from "lucide-react";
import { FullscreenDialog } from "@/components/ui/fullscreen-dialog";
import { SUPPORT_MAILTO } from "@/lib/site-config";
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

function InstallLink() {
  return (
    <Link
      className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted transition hover:bg-canvas hover:text-ink"
      href="/install"
    >
      <Smartphone aria-hidden="true" className="h-4 w-4" />
      Install app
    </Link>
  );
}

function KofiLink() {
  return (
    <a
      className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted transition hover:bg-canvas hover:text-ink"
      href="https://ko-fi.com/kefasaleck"
      rel="noreferrer"
      target="_blank"
    >
      <Heart aria-hidden="true" className="h-4 w-4" />
      Buy me a coffee
    </a>
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
  const pathname = usePathname();
  const lockViewport =
    pathname === "/data" || pathname === "/admin" || (pathname === "/activities" && isActivitiesTableTab);

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
          <InstallLink />
          <KofiLink />
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
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-line px-4 lg:hidden">
          <Link href="/">
            <Wordmark className="text-base" textClassName="text-ink" accentClassName="text-accent" />
          </Link>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsNavOpen(true)}
              aria-label="Open menu"
              className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted transition hover:text-ink"
            >
              <Menu className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
        </header>

        {/* The shell itself never scrolls -- the sidebar must stay put.
            Regular pages scroll their own content here; lockViewport pages
            (data table, admin users table, activities table tab) instead
            delegate scrolling to a nested region so their own
            header/toolbar/footer can stay pinned too. */}
        <main
          className={`mx-auto flex w-full max-w-7xl flex-1 flex-col px-3 pb-5 sm:px-6 lg:px-8 ${
            lockViewport ? "min-h-0 overflow-hidden" : "overflow-y-auto"
          }`}
        >
          {children}
        </main>
      </div>

      <FullscreenDialog
        contentClassName="flex h-full flex-col"
        isOpen={isNavOpen}
        onClose={() => setIsNavOpen(false)}
        title="Menu"
      >
        <SidebarNav
          isAdmin={isAdmin}
          isActivitiesEnabled={isActivitiesEnabled}
          isLiveMeterEnabled={isLiveMeterEnabled}
          onNavigate={() => setIsNavOpen(false)}
          size="lg"
        />
        <div className="mt-auto flex flex-col gap-3 pt-6">
          <InstallLink />
          <KofiLink />
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
      </FullscreenDialog>
    </div>
  );
}
