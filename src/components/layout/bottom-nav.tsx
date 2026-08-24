"use client";

import { List } from "@phosphor-icons/react";
import { usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";
import { filterQueryParamKeys, parseDateRangeQuery } from "@/lib/filter-query-params";
import { queryHref } from "@/lib/url-query";
import { buildNavItems, type NavPermissions } from "./nav-items";

type BottomNavProps = NavPermissions & {
  onOpenMenu: () => void;
  // True on regular pages, where AppShell now lets the document itself
  // scroll (so iOS Safari's toolbar can collapse) instead of containing
  // scroll inside a fixed-height flex column -- this bar can no longer
  // rely on being sized by that column and must pin itself to the viewport
  // directly. lockViewport pages (/data, /admin, Activities table) keep
  // the original fixed-height-column architecture unchanged, so they pass
  // false here and this stays a plain flex sibling exactly as before.
  overlay?: boolean;
};

// On lockViewport pages: a shrink-0 flex sibling of <main> inside the
// shell's fixed-height (100svh) flex column, so it just claims its own row
// and <main> shrinks to fit -- no manual bottom padding needed there. On
// regular (document-scrolling) pages: a fixed viewport overlay instead,
// since nothing in that flow is a fixed-height container anymore -- see
// AppShell's own main-padding comment for the matching bottom clearance.
export function BottomNav({ isAdmin, isActivitiesEnabled, isLiveMeterEnabled, onOpenMenu, overlay = false }: BottomNavProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { from, to } = parseDateRangeQuery(new URLSearchParams(searchParams.toString()));
  const dateParams = new URLSearchParams();

  if (from) {
    dateParams.set(filterQueryParamKeys.from, from);
  }

  if (to) {
    dateParams.set(filterQueryParamKeys.to, to);
  }

  const items = buildNavItems({ isAdmin, isActivitiesEnabled, isLiveMeterEnabled }).filter((item) => item.bottomNav);

  return (
    <nav
      className={`flex items-stretch border-t border-line bg-paper pb-[env(safe-area-inset-bottom)] lg:hidden ${
        overlay ? "fixed inset-x-0 bottom-0 z-20" : "shrink-0"
      }`}
    >
      {items.map((item) => {
        const href = item.preserveDateRange ? queryHref(item.href, dateParams) : item.href;
        const isActive = pathname === item.href;
        // nav-items.ts guarantees bottomIcon on every bottomNav:true item.
        const Icon = item.bottomIcon!;

        return (
          <Link
            aria-current={isActive ? "page" : undefined}
            className={`flex flex-1 flex-col items-center justify-center gap-1 pt-2 text-[0.6875rem] transition ${
              isActive ? "text-brandTeal" : "text-muted"
            }`}
            href={href}
            key={item.href}
          >
            <Icon aria-hidden="true" size={20} weight={isActive ? "fill" : "regular"} />
            {item.label}
          </Link>
        );
      })}
      <button
        aria-label="Open menu"
        className="flex flex-1 flex-col items-center justify-center gap-1 pt-2 text-[0.6875rem] text-muted transition"
        onClick={onOpenMenu}
        type="button"
      >
        <List aria-hidden="true" size={20} />
        More
      </button>
    </nav>
  );
}
