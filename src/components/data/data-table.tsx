"use client";

import { ArrowDown, ArrowUp, ArrowUpDown, RefreshCw, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { type ColumnDef, flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { FilterBar } from "@/components/dashboard/filter-bar";
import { DataExportAction } from "@/components/data/data-export-action";
import { DataSyncAction } from "@/components/data/data-sync-action";
import { DropdownSelect, type DropdownOption } from "@/components/ui/dropdown-select";
import { Card } from "@/components/ui/card";
import { ScrollHint } from "@/components/ui/scroll-hint";
import { Skeleton } from "@/components/ui/skeleton";
import { type ChargeTypeFilter } from "@/lib/data-table-query-params";
import { dataTableColumnAlign, dataTableColumnLabel } from "./columns";
import { inferQuickRange } from "@/lib/filters";
import { useDataTableUrlState } from "@/lib/use-data-table-url-state";
import { formatCurrency } from "@/lib/format";
import { buildEnergyRowsUrl } from "@/lib/endpoints";
import type { EnergyRow, SyncMetadata } from "@/lib/types";
import { amountClassFor, amountDisplayFor, tariffDisplayFor, usageDisplayFor } from "./row-formatting";
import type { SortDirection, SortKey } from "./types";

const chargeTypeLabelMap: Record<EnergyRow["chargeKind"], string> = {
  energy: "Energy",
  water: "Water",
  fixed: "Fixed",
  topup: "Top up",
  refund: "Refund"
};

const SEARCH_DEBOUNCE_MS = 250;
const pageSizeOptions: DropdownOption[] = [
  { label: "25 / page", value: "25" },
  { label: "50 / page", value: "50" },
  { label: "100 / page", value: "100" }
];

type EnergyRowsApiResponse = {
  rows: EnergyRow[];
  total: number;
  page: number;
  pageSize: number;
  sync: SyncMetadata;
  bounds: {
    from: string;
    to: string;
  };
};

function nextSortLabel(direction: SortDirection, active: boolean) {
  if (!active) {
    return <ArrowUpDown aria-hidden="true" className="ml-1 h-3.5 w-3.5 text-muted/55" />;
  }

  return direction === "asc" ? (
    <ArrowUp aria-hidden="true" className="ml-1 h-3.5 w-3.5 text-ink" />
  ) : (
    <ArrowDown aria-hidden="true" className="ml-1 h-3.5 w-3.5 text-ink" />
  );
}

async function fetchEnergyRows(params: URLSearchParams) {
  const response = await fetch(buildEnergyRowsUrl(params), { cache: "no-store" });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || "Failed to load energy rows.");
  }

  return (await response.json()) as EnergyRowsApiResponse;
}

function TableSkeletonRows({ columnCount, rowCount }: { columnCount: number; rowCount: number }) {
  return (
    <>
      {Array.from({ length: rowCount }, (_, rowIndex) => (
        <tr key={`skeleton-${rowIndex}`}>
          {Array.from({ length: columnCount }, (_, columnIndex) => (
            <td className="px-4 py-3" key={`skeleton-${rowIndex}-${columnIndex}`}>
              <Skeleton className="h-4 w-full" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

export function DataTable() {
  const {
    from,
    to,
    chargeType,
    searchQuery,
    page,
    pageSize,
    sortKey,
    sortDirection,
    isDatePending,
    isChargeTypePending,
    onDateChange,
    onQuickRange,
    onChargeTypeChange,
    onSearchChange,
    onSortChange,
    onPageChange,
    onPageSizeChange
  } = useDataTableUrlState();
  const [searchInput, setSearchInput] = useState(searchQuery);
  const [isManualRefreshing, setIsManualRefreshing] = useState(false);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tableScrollRef = useRef<HTMLDivElement>(null);

  const queryParams = useMemo(() => {
    const params = new URLSearchParams();

    if (from) {
      params.set("from", from);
    }

    if (to) {
      params.set("to", to);
    }

    if (chargeType !== "all") {
      params.set("chargeType", chargeType);
    }

    if (searchQuery) {
      params.set("search", searchQuery);
    }

    if (sortKey !== "captured") {
      params.set("sort", sortKey);
    }

    if (sortDirection !== "desc") {
      params.set("dir", sortDirection);
    }

    if (page > 1) {
      params.set("page", String(page));
    }

    if (pageSize !== 50) {
      params.set("pageSize", String(pageSize));
    }

    return params;
  }, [chargeType, from, page, pageSize, searchQuery, sortDirection, sortKey, to]);

  const { data, isFetching, isLoading, error, refetch } = useQuery({
    queryKey: ["energy-rows", queryParams.toString()],
    queryFn: () => fetchEnergyRows(queryParams),
    placeholderData: keepPreviousData
  });

  const rows = data?.rows ?? [];
  const totalRows = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(totalRows / pageSize));
  const displayFrom = from || data?.bounds.from || "";
  const displayTo = to || data?.bounds.to || "";
  const effectiveQuickRange = inferQuickRange(displayFrom, displayTo, data?.bounds);

  const handleQuickRangeChange = (
    range: "pastWeek" | "pastMonth" | "past3Months" | "thisMonth" | "thisWeek" | "allTime"
  ) => {
    if (range === "allTime") {
      const allTimeFrom = data?.bounds.from || "";
      const allTimeTo = data?.bounds.to || "";

      if (allTimeFrom && allTimeTo) {
        onDateChange(allTimeFrom, allTimeTo);
        return;
      }
    }

    onQuickRange(range);
  };

  const columns = useMemo<ColumnDef<EnergyRow>[]>(
    () => [
      {
        id: "period",
        accessorFn: (row) => row.periodDateTime,
        header: dataTableColumnLabel.period,
        cell: ({ row }) => <span className="font-medium text-ink">{row.original.periodDateTime.replace("T", " ")}</span>
      },
      {
        id: "type",
        accessorFn: (row) => row.chargeKind,
        header: dataTableColumnLabel.type,
        cell: ({ row }) => (
          <span className="rounded bg-canvas px-2 py-1 text-xs font-medium uppercase tracking-[0.12em] text-muted">
            {row.original.chargeKind}
          </span>
        )
      },
      {
        id: "band",
        accessorFn: (row) => row.chargeLabel,
        header: dataTableColumnLabel.band,
        cell: ({ row }) => (
          <span className="text-muted">
            {row.original.chargeLabel.replace("Energy Charge: ", "").replace("Water: ", "")}
          </span>
        )
      },
      {
        id: "kwh",
        accessorFn: (row) => row.usageAmount,
        header: dataTableColumnLabel.kwh,
        cell: ({ row }) => <span className="text-ink">{usageDisplayFor(row.original)}</span>
      },
      {
        id: "tariff",
        accessorFn: (row) => row.tariff,
        header: dataTableColumnLabel.tariff,
        cell: ({ row }) => <span className="text-muted">{tariffDisplayFor(row.original)}</span>
      },
      {
        id: "amount",
        accessorFn: (row) => row.cost,
        header: () => (
          <>
            <span className="sm:hidden">Amount</span>
            <span className="hidden sm:inline">{dataTableColumnLabel.amount}</span>
          </>
        ),
        cell: ({ row }) => <span className={amountClassFor(row.original)}>{amountDisplayFor(row.original)}</span>
      },
      {
        id: "balance",
        accessorFn: (row) => row.balance,
        header: dataTableColumnLabel.balance,
        cell: ({ row }) => <span className="text-muted">{formatCurrency(row.original.balance)}</span>
      },
      {
        id: "captured",
        accessorFn: (row) => row.captureDateTime,
        header: dataTableColumnLabel.captured,
        cell: ({ row }) => <span className="text-muted">{row.original.captureDateTime}</span>
      }
    ],
    []
  );

  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    manualSorting: true,
    pageCount,
    state: {
      pagination: {
        pageIndex: Math.max(0, page - 1),
        pageSize
      },
      sorting: [
        {
          id: sortKey,
          desc: sortDirection === "desc"
        }
      ]
    }
  });

  const chargeTypeOptions = useMemo<DropdownOption[]>(() => {
    return [
      { label: "All types", value: "all" },
      { label: chargeTypeLabelMap.energy, value: "energy" },
      { label: chargeTypeLabelMap.water, value: "water" },
      { label: chargeTypeLabelMap.fixed, value: "fixed" },
      { label: chargeTypeLabelMap.topup, value: "topup" },
      { label: chargeTypeLabelMap.refund, value: "refund" }
    ];
  }, []);

  const chargeTypeFilterControl = (
    <DropdownSelect
      ariaLabel="Charge type"
      value={chargeType}
      options={chargeTypeOptions}
      onChange={(value) => onChargeTypeChange(value as ChargeTypeFilter)}
      loading={isChargeTypePending}
      className="w-32"
      tone="dark"
    />
  );

  const searchFilterControl = (
    <div className="relative w-full sm:w-52">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/70" />
      <input
        aria-label="Search rows"
        className="h-9 w-full rounded-md border border-white/15 bg-white/10 pl-9 pr-3 text-sm text-white placeholder:text-white/50 outline-none focus:border-white/40"
        value={searchInput}
        onBlur={(event) => {
          if (searchDebounceRef.current) {
            clearTimeout(searchDebounceRef.current);
            searchDebounceRef.current = null;
          }

          onSearchChange(event.currentTarget.value);
        }}
        onChange={(event) => {
          const nextValue = event.target.value;
          setSearchInput(nextValue);

          if (searchDebounceRef.current) {
            clearTimeout(searchDebounceRef.current);
          }

          searchDebounceRef.current = setTimeout(() => {
            onSearchChange(nextValue);
          }, SEARCH_DEBOUNCE_MS);
        }}
        placeholder="Search"
      />
    </div>
  );

  const handleRefresh = async () => {
    setIsManualRefreshing(true);

    try {
      await refetch();
    } finally {
      setIsManualRefreshing(false);
    }
  };

  const refreshControl = (
    <button
      aria-label="Refresh rows"
      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-sm text-muted transition enabled:hover:text-ink disabled:cursor-not-allowed disabled:opacity-60"
      disabled={isManualRefreshing}
      onClick={() => {
        void handleRefresh();
      }}
      type="button"
      title="Refresh rows"
    >
      <RefreshCw aria-hidden="true" className={`h-4 w-4 ${isManualRefreshing ? "animate-spin" : ""}`} />
    </button>
  );

  const desktopRefreshControl = <div className="hidden sm:block">{refreshControl}</div>;
  const mobileRefreshControl = <div className="sm:hidden">{refreshControl}</div>;
  const hasPreviousPage = page > 1;
  const hasNextPage = page < pageCount;
  const showTableSkeleton = isLoading || isManualRefreshing;
  const skeletonRowCount = Math.min(pageSize, 12);

  useEffect(() => {
    const boundsFrom = data?.bounds.from || "";
    const boundsTo = data?.bounds.to || "";

    if (from || to || !boundsFrom || !boundsTo) {
      return;
    }

    onDateChange(boundsFrom, boundsTo);
  }, [data?.bounds.from, data?.bounds.to, from, onDateChange, to]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 pt-6">
      <FilterBar
        from={displayFrom}
        to={displayTo}
        quickRange={effectiveQuickRange}
        onDateChange={onDateChange}
        onQuickRange={handleQuickRangeChange}
        loading={isDatePending}
        leftControls={<DataSyncAction lastSyncedAt={data?.sync.lastSyncedAt} loading={isLoading} />}
        extraControls={chargeTypeFilterControl}
        rightControls={
          <div className="flex items-center gap-2">
            {searchFilterControl}
            <DataExportAction iconOnly={false} />
          </div>
        }
        fullBleed
      />

      <Card className="flex h-0 min-h-0 flex-1 flex-col overflow-hidden">
        <div className="relative min-h-0 flex-1">
          <div className="h-full overflow-auto" ref={tableScrollRef}>
            <table className="w-full min-w-[860px] border-separate border-spacing-0 text-left text-sm">
              <thead className="sticky top-0 z-10 border-b border-line bg-accentSoft text-xs uppercase tracking-[0.16em] text-brandTeal dark:text-accent shadow-[0_1px_0_rgb(var(--color-line))]">
                {table.getHeaderGroups().map((headerGroup) => (
                  <tr key={headerGroup.id}>
                    {headerGroup.headers.map((header) => {
                      const id = header.column.id as SortKey;
                      const alignClass = dataTableColumnAlign[id] ?? "text-left";
                      const isActive = sortKey === id;

                      return (
                        <th className={`px-4 py-3 ${alignClass}`} key={header.id}>
                          <button
                            className="inline-flex items-center font-medium uppercase tracking-[0.16em]"
                            onClick={() => onSortChange(id)}
                            type="button"
                          >
                            {flexRender(header.column.columnDef.header, header.getContext())}
                            {nextSortLabel(sortDirection, isActive)}
                          </button>
                        </th>
                      );
                    })}
                  </tr>
                ))}
              </thead>
              <tbody className="divide-y divide-line">
                {showTableSkeleton ? (
                  <TableSkeletonRows columnCount={columns.length} rowCount={skeletonRowCount} />
                ) : (
                  table.getRowModel().rows.map((row) => (
                    <tr className="transition hover:bg-canvas/70" key={row.id}>
                      {row.getVisibleCells().map((cell) => {
                        const alignClass = dataTableColumnAlign[cell.column.id] ?? "text-left";

                        return (
                          <td className={`px-4 py-3 ${alignClass}`} key={cell.id}>
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </td>
                        );
                      })}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <ScrollHint containerRef={tableScrollRef} />
        </div>

        <div className="shrink-0 flex flex-col gap-3 border-t border-line px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted">
            Page {Math.min(page, pageCount)} of {pageCount}
            {!isLoading ? ` · ${totalRows} rows` : ""}
            {isFetching && !isLoading ? " \u00b7 updating..." : ""}
          </p>
          <div className="flex items-center gap-2">
            {desktopRefreshControl}
            <DropdownSelect
              ariaLabel="Rows per page"
              value={String(pageSize)}
              options={pageSizeOptions}
              onChange={(value) => onPageSizeChange(Number(value))}
              menuPlacement="top"
              className="w-32"
            />
            <button
              className="inline-flex h-9 items-center rounded-md border border-line bg-paper px-3 text-sm text-muted transition enabled:hover:bg-canvas enabled:hover:text-ink disabled:cursor-not-allowed disabled:opacity-60"
              disabled={!hasPreviousPage}
              onClick={() => onPageChange(page - 1)}
              type="button"
            >
              Previous
            </button>
            <button
              className="inline-flex h-9 items-center rounded-md border border-line bg-paper px-3 text-sm text-muted transition enabled:hover:bg-canvas enabled:hover:text-ink disabled:cursor-not-allowed disabled:opacity-60"
              disabled={!hasNextPage}
              onClick={() => onPageChange(page + 1)}
              type="button"
            >
              Next
            </button>
            {mobileRefreshControl}
          </div>
        </div>

        {error instanceof Error ? <p className="px-3 py-2 text-sm text-red-500">{error.message}</p> : null}
      </Card>
    </div>
  );
}
