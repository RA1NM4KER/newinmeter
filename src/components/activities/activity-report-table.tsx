"use client";

import { useRef } from "react";
import { type ColumnDef, flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { Pencil } from "lucide-react";
import { activityReportColumns, type ActivityReportSortKey } from "./activity-report-columns";
import { ActivityReportSkeletonRows } from "./activity-report-skeleton-rows";
import { ActivityCardSkeletonList } from "./activity-card-skeleton-list";
import { ActivityTagChip } from "./tag-chip";
import { formatActivityMetric } from "./activity-report-model";
import { ScrollHint } from "@/components/ui/scroll-hint";
import { MobileSortControls } from "@/components/ui/mobile-sort-controls";
import { SortHeaderButton } from "@/components/ui/sort-header-button";
import { activityTimeLabel, formatActivityDuration } from "@/lib/activity/utils";
import { chartDate, formatCurrency, formatKl, formatKwh } from "@/lib/format";
import type { ActivityReportRow } from "@/lib/types";
import type { ActivityReportTableProps } from "./types";

const activityMobileSortOptions = activityReportColumns
  .filter((column) => column.sortable)
  .map((column) => ({ label: column.label, value: column.id }));

// Mobile-only stand-in for the table below <sm>: 11 columns squeezed into a
// horizontally-scrollable table read badly on a phone. Reads straight from
// an ActivityReportRow, not the TanStack column defs, using the same
// formatting helpers the desktop columns use so the numbers can't drift
// between the two views. The whole card is clickable, matching the
// desktop row's own onClick-to-edit behaviour.
function ActivityRowCard({
  activity,
  onEdit
}: {
  activity: ActivityReportRow;
  onEdit: (activity: ActivityReportRow) => void;
}) {
  return (
    <div className="flex cursor-pointer flex-col gap-1.5 px-4 py-3" onClick={() => onEdit(activity)}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2">
          <span
            aria-label={`Activity colour ${activity.color}`}
            className="mt-1 h-3 w-3 shrink-0 rounded-full"
            style={{ backgroundColor: activity.color }}
          />
          <div className="flex flex-wrap gap-1">
            {activity.tags.map((tag) => (
              <ActivityTagChip key={tag} tag={tag} />
            ))}
          </div>
        </div>
        <button
          aria-label={`Edit ${activity.tags.join(", ") || "activity"}`}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted outline-none transition hover:text-ink focus-visible:ring-1 focus-visible:ring-line"
          onClick={(event) => {
            event.stopPropagation();
            onEdit(activity);
          }}
          type="button"
        >
          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>

      <p className="text-sm text-muted">
        {chartDate(activity.date)} &middot; {activityTimeLabel(activity)} &middot;{" "}
        {formatActivityDuration(activity.durationMinutes)}
      </p>

      <div className="flex flex-col gap-0.5 text-sm">
        <p className="text-ink">
          Electricity {formatKwh(activity.electricityKwh)} &middot; avg{" "}
          {formatActivityMetric("averageKw", activity.averageKw)} &middot; {formatCurrency(activity.electricitySpend)}
        </p>
        <p className="text-muted">
          Water {formatKl(activity.waterKl)} &middot; {formatCurrency(activity.waterSpend)}
        </p>
      </div>

      {activity.note ? <p className="text-sm text-muted">{activity.note}</p> : null}
    </div>
  );
}

export function ActivityReportTable({
  rows,
  error,
  isLoading,
  hasNoActivitiesEver,
  onEdit,
  sortKey,
  sortDirection,
  onSortChange,
  onSortKeyChange,
  onSortDirectionChange
}: ActivityReportTableProps) {
  const tableScrollRef = useRef<HTMLDivElement>(null);

  // Columns close over the edit callback, so this is rebuilt every render
  // rather than memoized -- same cost as the inline JSX it replaces.
  const columns: ColumnDef<ActivityReportRow>[] = activityReportColumns.map((column) => ({
    id: column.id,
    header: column.label,
    cell: ({ row }) => {
      const activity = row.original;

      switch (column.id) {
        case "date":
          return chartDate(activity.date);
        case "time":
          return activityTimeLabel(activity);
        case "tags":
          return (
            <div className="flex items-start gap-2">
              <span
                aria-label={`Activity colour ${activity.color}`}
                className="mt-1 h-3 w-3 shrink-0 rounded-full"
                style={{ backgroundColor: activity.color }}
              />
              <div className="flex max-w-52 flex-wrap gap-1">
                {activity.tags.map((tag) => (
                  <ActivityTagChip key={tag} tag={tag} />
                ))}
              </div>
            </div>
          );
        case "duration":
          return formatActivityDuration(activity.durationMinutes);
        case "electricityUsage":
          return formatKwh(activity.electricityKwh);
        case "averageDemand":
          return formatActivityMetric("averageKw", activity.averageKw);
        case "electricitySpend":
          return formatCurrency(activity.electricitySpend);
        case "waterUsage":
          return formatKl(activity.waterKl);
        case "waterSpend":
          return formatCurrency(activity.waterSpend);
        case "note":
          return activity.note ?? "-";
        case "actions":
          return (
            // Redundant with the row click, same as admin's manage-feature
            // pencil -- it's the discoverable "this row opens something"
            // affordance, not the only way in. Always visible on touch
            // (no reliable hover there); hidden until row hover on desktop.
            <button
              aria-label={`Edit ${activity.tags.join(", ") || "activity"}`}
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted opacity-100 outline-none transition hover:text-ink focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-line sm:opacity-0 sm:group-hover:opacity-100"
              onClick={(event) => {
                event.stopPropagation();
                onEdit(activity);
              }}
              type="button"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          );
      }
    }
  }));
  const table = useReactTable({ data: rows, columns, getCoreRowModel: getCoreRowModel() });

  return (
    // Not the shared Card component here -- its rounded-lg/border are
    // hardcoded ahead of any className override, which would fight this
    // section's own mobile-vs-desktop responsive overrides at equal
    // specificity. On mobile the table breaks out to the full screen width
    // (matching FilterBar's own fullBleed breakout) and drops its
    // border/radius so it reads as one continuous surface, restored back to
    // a normal bordered card at lg+ -- same treatment as /data's table.
    <section className="-mx-3 flex h-0 min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-line bg-paper sm:-mx-6 lg:mx-0 lg:rounded-lg lg:border">
      <div className="relative min-h-0 flex-1">
        {/* Below sm: one card per activity, no horizontal scroll. At sm+:
            the full table, unchanged. */}
        <div className="flex h-full min-h-0 flex-col sm:hidden">
          <MobileSortControls
            direction={sortDirection}
            onDirectionChange={onSortDirectionChange}
            onSortKeyChange={onSortKeyChange}
            options={activityMobileSortOptions}
            sortKey={sortKey}
          />
          <div className="min-h-0 flex-1 overflow-auto">
            {isLoading ? (
              <ActivityCardSkeletonList count={6} />
            ) : (
              <div className="divide-y divide-line">
                {rows.map((activity) => (
                  <ActivityRowCard activity={activity} key={activity.id} onEdit={onEdit} />
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="hidden h-full overflow-auto sm:block" ref={tableScrollRef}>
          <table className="w-full min-w-[1180px] border-separate border-spacing-0 text-left text-sm">
            <thead className="sticky top-0 z-10 border-b border-line bg-accentSoft text-xs uppercase tracking-[0.12em] text-brandTeal dark:text-accent">
              <tr>
                {activityReportColumns.map((column) => (
                  <th className="px-3 py-3 font-medium" key={column.id}>
                    {column.sortable ? (
                      <SortHeaderButton
                        label={column.label}
                        shortLabel={column.shortLabel}
                        active={sortKey === column.id}
                        direction={sortDirection}
                        onClick={() => onSortChange(column.id as ActivityReportSortKey)}
                      />
                    ) : (
                      column.label
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {isLoading ? (
                <ActivityReportSkeletonRows rowCount={8} />
              ) : (
                table.getRowModel().rows.map((row) => (
                  <tr
                    className="group cursor-pointer align-top transition hover:bg-canvas/60"
                    key={row.original.id}
                    onClick={() => onEdit(row.original)}
                  >
                    {row.getVisibleCells().map((cell) => {
                      const cellClassName =
                        activityReportColumns.find((column) => column.id === cell.column.id)?.cellClassName ?? "";

                      return (
                        <td className={`px-3 py-3 ${cellClassName}`} key={cell.id}>
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
        <div className="hidden sm:block">
          <ScrollHint containerRef={tableScrollRef} />
        </div>
      </div>

      {!rows.length && !isLoading && !hasNoActivitiesEver ? (
        <p className="p-6 text-center text-sm text-muted">Add an activity or adjust the filters to build a report.</p>
      ) : null}

      {error ? <p className="px-3 py-2 text-sm text-red-500">{error.message}</p> : null}
    </section>
  );
}
