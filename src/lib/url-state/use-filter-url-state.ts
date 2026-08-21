"use client";

import { useMemo, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { defaultRange, inferQuickRange, quickRangeFromLatest, type QuickRangePreset } from "@/lib/filters";
import { dateRangeQueryUpdates, parseDateRangeQuery } from "@/lib/filter-query-params";
import { applyQueryUpdates, queryHref } from "@/lib/url-query";
import type { QuickRange } from "@/lib/types";

type FilterUrlState = {
  from: string;
  to: string;
  quickRange: QuickRange;
  isPending: boolean;
  onDateChange: (from: string, to: string) => void;
  onQuickRange: (range: QuickRangePreset) => void;
};

function resolveStateFromQuery(
  dateBounds: { from?: string; to?: string },
  searchParams: URLSearchParams
): Omit<FilterUrlState, "isPending" | "onDateChange" | "onQuickRange"> {
  const fallback = defaultRange(dateBounds);
  const { from, to } = parseDateRangeQuery(searchParams);

  if (!from || !to) {
    return fallback;
  }

  if (from === fallback.from && to === fallback.to) {
    return {
      from,
      to,
      quickRange: fallback.quickRange
    };
  }

  return {
    from,
    to,
    quickRange: inferQuickRange(from, to, dateBounds)
  };
}

export function useFilterUrlState(dateBounds: { from?: string; to?: string }): FilterUrlState {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const state = useMemo(() => {
    return resolveStateFromQuery(dateBounds, new URLSearchParams(searchParams.toString()));
  }, [dateBounds, searchParams]);

  const updateSearchParams = (updates: Record<string, string | null>) => {
    const next = applyQueryUpdates(searchParams, updates);
    startTransition(() => {
      router.replace(queryHref(pathname, next), { scroll: false });
    });
  };

  const onQuickRange = (range: QuickRangePreset) => {
    if (range === "allTime" && dateBounds.from && dateBounds.to) {
      updateSearchParams(dateRangeQueryUpdates(dateBounds.from, dateBounds.to));
      return;
    }

    const nextRange = quickRangeFromLatest(range);
    updateSearchParams(dateRangeQueryUpdates(nextRange.from, nextRange.to));
  };

  const onDateChange = (from: string, to: string) => {
    updateSearchParams(dateRangeQueryUpdates(from, to));
  };

  return {
    ...state,
    isPending,
    onDateChange,
    onQuickRange
  };
}
