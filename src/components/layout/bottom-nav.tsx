"use client";

import { List } from "@phosphor-icons/react";
import { usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";
import { filterQueryParamKeys, parseDateRangeQuery } from "@/lib/filter-query-params";
import { queryHref } from "@/lib/url-query";
import { buildNavItems, type NavPermissions } from "./nav-items";

type BottomNavProps = NavPermissions & {
  onOpenMenu: () => void;
};

// Lives as a shrink-0 flex sibling of <main> in AppShell, not `fixed` --
// the shell's root is already a fixed-height (100svh) flex column, so this
// just claims its own row and <main> shrinks to fit, no manual bottom
// padding needed on any page (including the lockViewport ones that manage
// their own internal scroll region).
export function BottomNav({ isAdmin, isActivitiesEnabled, isLiveMeterEnabled, onOpenMenu }: BottomNavProps) {
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
    <nav className="flex shrink-0 items-stretch border-t border-line bg-paper pb-[env(safe-area-inset-bottom)] lg:hidden">
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
