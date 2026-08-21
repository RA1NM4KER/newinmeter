"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { parseDateRangeQuery, filterQueryParamKeys } from "@/lib/filter-query-params";
import { queryHref } from "@/lib/url-query";
import { buildNavItems, type NavPermissions } from "./nav-items";

const ACTIVITIES_SEEN_KEY = "activities-nav-seen";

// The desktop sidebar rail. Mobile has its own bottom nav bar (bottom-nav.tsx)
// plus a compact overflow menu (BottomSheet in app-shell.tsx) instead of a
// drawer-sized version of this, so this only ever needs the compact styling.
export function SidebarNav({
  isAdmin = false,
  isActivitiesEnabled = false,
  isLiveMeterEnabled = false
}: NavPermissions) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { from, to } = parseDateRangeQuery(new URLSearchParams(searchParams.toString()));
  const dateParams = new URLSearchParams();
  // Gated features (Live, Activities) are opt-in per user -- anyone without
  // the permission simply doesn't see the entry point at all.
  const items = buildNavItems({ isAdmin, isActivitiesEnabled, isLiveMeterEnabled });
  // Defaults to hidden, not shown -- the server has no localStorage to
  // check, so defaulting to "shown" would flash the badge on every refresh
  // for someone who already dismissed it. Starting hidden means a returning
  // visitor never sees it at all; a genuinely new visitor sees it appear a
  // beat after mount instead, which is the far less jarring direction.
  const [showActivitiesBadge, setShowActivitiesBadge] = useState(false);

  useEffect(() => {
    if (pathname === "/activities") {
      localStorage.setItem(ACTIVITIES_SEEN_KEY, "1");
      return;
    }

    if (!localStorage.getItem(ACTIVITIES_SEEN_KEY)) {
      setShowActivitiesBadge(true);
    }
  }, [pathname]);

  if (from) {
    dateParams.set(filterQueryParamKeys.from, from);
  }

  if (to) {
    dateParams.set(filterQueryParamKeys.to, to);
  }

  return (
    <nav className="flex flex-col gap-1">
      {items.map((item) => {
        const href = item.preserveDateRange ? queryHref(item.href, dateParams) : item.href;
        const isActive = pathname === item.href;
        const Icon = item.icon;

        return (
          <Link
            key={item.href}
            href={href}
            aria-current={isActive ? "page" : undefined}
            className={`flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm transition ${
              isActive ? "bg-paper font-medium text-ink shadow-sm" : "text-muted hover:bg-paper/60 hover:text-ink"
            }`}
          >
            <span
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition ${
                isActive ? "bg-brandTeal text-white" : "text-muted"
              }`}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
            </span>
            {item.label}
            {"isNew" in item && item.isNew && showActivitiesBadge ? (
              <span className="ml-auto rounded-full border border-accent/30 bg-accentSoft px-2 py-0.5 text-[0.65rem] font-medium tracking-wide text-accent">
                New
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
