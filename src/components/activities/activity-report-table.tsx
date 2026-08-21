"use client";

import { useRef } from "react";
import { type ColumnDef, flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { Pencil } from "lucide-react";
import { activityReportColumns, type ActivityReportSortKey } from "./activity-report-columns";
import { ActivityReportSkeletonRows } from "./activity-report-skeleton-rows";
import { ActivityTagChip } from "./tag-chip";
import { formatActivityMetric } from "./activity-report-model";
import { Card } from "@/components/ui/card";
import { ScrollHint } from "@/components/ui/scroll-hint";
import { SortHeaderButton } from "@/components/ui/sort-header-button";
import { activityTimeLabel, formatActivityDuration } from "@/lib/activity/utils";
import { chartDate, formatCurrency, formatKl, formatKwh } from "@/lib/format";
import type { ActivityReportRow } from "@/lib/types";
import type { ActivityReportTableProps } from "./types";

export function ActivityReportTable({
  rows,
  error,
  isLoading,
  hasNoActivitiesEver,
  onEdit,
  sortKey,
  sortDirection,
  onSortChange
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
    <Card className="flex h-0 min-h-0 flex-1 flex-col overflow-hidden">
      <div className="relative min-h-0 flex-1">
        <div className="h-full overflow-auto" ref={tableScrollRef}>
          <table className="w-full min-w-[1180px] border-separate border-spacing-0 text-left text-sm">
            <thead className="sticky top-0 z-10 border-b border-line bg-accentSoft text-xs uppercase tracking-[0.12em] text-brandTeal dark:text-accent">
              <tr>
                {activityReportColumns.map((column) => (
                  <th className="px-3 py-3 font-medium" key={column.id}>
                    {column.sortable ? (
                      <SortHeaderButton
                        label={column.label}
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
        <ScrollHint containerRef={tableScrollRef} />
      </div>

      {!rows.length && !isLoading && !hasNoActivitiesEver ? (
        <p className="p-6 text-center text-sm text-muted">Add an activity or adjust the filters to build a report.</p>
      ) : null}

      <div className="flex h-11 shrink-0 items-center gap-3 border-t border-line px-3">
        <p className="text-sm text-muted">
          {isLoading ? "Loading activities..." : `${rows.length} ${rows.length === 1 ? "activity" : "activities"}`}
        </p>
      </div>

      {error ? <p className="px-3 py-2 text-sm text-red-500">{error.message}</p> : null}
    </Card>
  );
}
