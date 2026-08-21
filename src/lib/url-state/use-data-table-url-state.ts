"use client";

import { useMemo, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { inferQuickRange, quickRangeFromLatest, type QuickRangePreset } from "@/lib/filters";
import { dateRangeQueryUpdates } from "@/lib/filter-query-params";
import {
  dataTableQueryParamKeys,
  pageSizeOptions,
  parseDataTableQuery,
  type ChargeTypeFilter
} from "@/lib/data-table-query-params";
import { applyQueryUpdates, queryHref } from "@/lib/url-query";
import type { QuickRange } from "@/lib/types";
import type { SortDirection, SortKey } from "@/components/data/types";

export type DataTableUrlState = {
  from: string;
  to: string;
  quickRange: QuickRange;
  chargeType: ChargeTypeFilter;
  searchQuery: string;
  page: number;
  pageSize: number;
  sortKey: SortKey;
  sortDirection: SortDirection;
  isDatePending: boolean;
  isChargeTypePending: boolean;
  onDateChange: (from: string, to: string) => void;
  onQuickRange: (range: QuickRangePreset) => void;
  onChargeTypeChange: (chargeType: ChargeTypeFilter) => void;
  onSearchChange: (query: string) => void;
  onSortChange: (key: SortKey) => void;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
};

function resolveStateFromQuery(
  searchParams: URLSearchParams
): Omit<
  DataTableUrlState,
  | "isDatePending"
  | "isChargeTypePending"
  | "onDateChange"
  | "onQuickRange"
  | "onChargeTypeChange"
  | "onSearchChange"
  | "onSortChange"
  | "onPageChange"
  | "onPageSizeChange"
> {
  const parsed = parseDataTableQuery(searchParams);

  return {
    from: parsed.from,
    to: parsed.to,
    quickRange: inferQuickRange(parsed.from, parsed.to),
    chargeType: parsed.chargeType,
    searchQuery: parsed.search,
    page: parsed.page,
    pageSize: parsed.pageSize,
    sortKey: parsed.sortKey,
    sortDirection: parsed.sortDirection
  };
}

export function useDataTableUrlState(): DataTableUrlState {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isDatePending, startDateTransition] = useTransition();
  const [isChargeTypePending, startChargeTypeTransition] = useTransition();
  const [, startMiscTransition] = useTransition();

  const state = useMemo(() => {
    return resolveStateFromQuery(new URLSearchParams(searchParams.toString()));
  }, [searchParams]);

  const updateSearchParams = (
    updates: Record<string, string | null>,
    startTransition: (callback: () => void) => void
  ) => {
    const next = applyQueryUpdates(searchParams, updates);
    startTransition(() => {
      router.replace(queryHref(pathname, next), { scroll: false });
    });
  };

  const onQuickRange = (range: QuickRangePreset) => {
    const nextRange = quickRangeFromLatest(range);

    updateSearchParams(
      {
        ...dateRangeQueryUpdates(nextRange.from, nextRange.to),
        [dataTableQueryParamKeys.page]: "1"
      },
      startDateTransition
    );
  };

  const onDateChange = (from: string, to: string) => {
    updateSearchParams(
      {
        ...dateRangeQueryUpdates(from, to),
        [dataTableQueryParamKeys.page]: "1"
      },
      startDateTransition
    );
  };

  const onChargeTypeChange = (chargeType: ChargeTypeFilter) => {
    updateSearchParams(
      {
        [dataTableQueryParamKeys.chargeType]: chargeType === "all" ? null : chargeType,
        [dataTableQueryParamKeys.page]: "1"
      },
      startChargeTypeTransition
    );
  };

  const onSearchChange = (query: string) => {
    const next = query.trim();

    if (next === state.searchQuery) {
      return;
    }

    updateSearchParams(
      {
        [dataTableQueryParamKeys.search]: next || null,
        [dataTableQueryParamKeys.page]: "1"
      },
      startMiscTransition
    );
  };

  const onSortChange = (key: SortKey) => {
    const nextDirection = state.sortKey === key && state.sortDirection === "desc" ? "asc" : "desc";

    updateSearchParams(
      {
        [dataTableQueryParamKeys.sort]: key === "captured" ? null : key,
        [dataTableQueryParamKeys.direction]: nextDirection === "desc" ? null : nextDirection,
        [dataTableQueryParamKeys.page]: "1"
      },
      startMiscTransition
    );
  };

  const onPageChange = (page: number) => {
    const nextPage = page > 1 ? String(Math.floor(page)) : null;

    updateSearchParams(
      {
        [dataTableQueryParamKeys.page]: nextPage
      },
      startMiscTransition
    );
  };

  const onPageSizeChange = (size: number) => {
    const nextSize = pageSizeOptions.includes(size as (typeof pageSizeOptions)[number]) ? size : 50;

    updateSearchParams(
      {
        [dataTableQueryParamKeys.pageSize]: nextSize === 50 ? null : String(nextSize),
        [dataTableQueryParamKeys.page]: null
      },
      startMiscTransition
    );
  };

  return {
    ...state,
    isDatePending,
    isChargeTypePending,
    onDateChange,
    onQuickRange,
    onChargeTypeChange,
    onSearchChange,
    onSortChange,
    onPageChange,
    onPageSizeChange
  };
}
