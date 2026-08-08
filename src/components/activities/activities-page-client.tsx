"use client";

import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Info } from "lucide-react";
import { ActivityExportButton } from "./activity-export-button";
import { ActivityDialog } from "./activity-dialog";
import { ActivityReportChart, activityMetricOptions } from "./activity-report-chart";
import { formatActivityMetric } from "./activity-report-model";
import { ActivityTagChip } from "./tag-chip";
import { TagFilter } from "./tag-filter";
import { ChartShell } from "@/components/charts/chart-shell";
import { FilterBar } from "@/components/dashboard/filter-bar";
import { Card, CardHeader } from "@/components/ui/card";
import { DropdownSelect } from "@/components/ui/dropdown-select";
import { MetricCard } from "@/components/ui/metric-card";
import { ScrollHint } from "@/components/ui/scroll-hint";
import { buildActivitySearchParams } from "@/lib/activity-query-params";
import { fetchActivityReport, fetchActivityTags, removeActivity } from "@/lib/activity-client";
import { activityTimeLabel, formatActivityDuration } from "@/lib/activity-utils";
import { chartDate, formatCurrency, formatKl, formatKwh } from "@/lib/format";
import { useFilterUrlState } from "@/lib/use-filter-url-state";
import type { ActivityMetric, UsageActivity } from "@/lib/types";

export function ActivitiesPageClient({ bounds }: { bounds: { from?: string; to?: string } }) {
  const { from, to, quickRange, isPending, onDateChange, onQuickRange } = useFilterUrlState(bounds);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [metric, setMetric] = useState<ActivityMetric>("electricityKwh");
  const [dialogActivity, setDialogActivity] = useState<UsageActivity | null | undefined>(undefined);
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const filters = useMemo(() => ({ from, to, tags: selectedTags }), [from, selectedTags, to]);
  const { data, isLoading, error } = useQuery({
    queryKey: ["activity-report", filters],
    queryFn: () => fetchActivityReport(filters),
    enabled: Boolean(from && to)
  });
  const { data: tagsData } = useQuery({ queryKey: ["activity-tags"], queryFn: fetchActivityTags });
  const deletion = useMutation({
    mutationFn: removeActivity,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["activities"] }),
        queryClient.invalidateQueries({ queryKey: ["activity-report"] }),
        queryClient.invalidateQueries({ queryKey: ["activity-tags"] })
      ]);
    }
  });
  const rows = data?.rows ?? [];
  const summary = data?.summary;
  const exportParams = buildActivitySearchParams({ ...filters, metric });
  // Every activity requires at least one tag (see validateActivityInput), so
  // an empty tag vocabulary -- once it's actually loaded -- means the
  // account has never had a single activity, regardless of the current
  // date/tag filters. That's the signal for "first-time" vs. "your filters
  // just don't match anything".
  const hasNoActivitiesEver = tagsData !== undefined && tagsData.tags.length === 0;

  return (
    <div className="flex flex-1 flex-col gap-5 py-6">
      <FilterBar
        from={from}
        to={to}
        quickRange={quickRange}
        onDateChange={onDateChange}
        onQuickRange={onQuickRange}
        loading={isPending}
        leftControls={
          <button
            className="inline-flex h-9 items-center rounded-md bg-white px-3 text-sm font-medium text-brandTeal"
            onClick={() => setDialogActivity(null)}
            type="button"
          >
            + Add activity
          </button>
        }
        extraControls={<TagFilter tags={tagsData?.tags ?? []} selected={selectedTags} onChange={setSelectedTags} />}
        rightControls={<ActivityExportButton params={exportParams} />}
        splitMobileRow
        fullBleed
      />

      <div>
        <h1 className="text-xl font-semibold text-ink">Activities</h1>
        <p className="mt-1 text-sm text-muted">Compare household usage during the periods you tagged.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard label="Activities" value={String(summary?.activityCount ?? 0)} detail="Filtered occurrences" />
        <MetricCard
          label="Tagged duration"
          value={formatActivityDuration(summary?.taggedDurationMinutes ?? 0)}
          detail="Overlaps counted once"
        />
        <MetricCard
          label="Household electricity"
          value={formatKwh(summary?.electricityKwh ?? 0)}
          detail="Overlapping intervals counted once"
        />
        <MetricCard
          label="Average per activity"
          value={formatKwh(summary?.averageElectricityKwhPerActivity ?? 0)}
          detail="Average household usage per occurrence"
        />
      </div>

      <div className="flex gap-2 rounded-md border border-line bg-paper px-3 py-3 text-sm text-muted">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
        <p>
          Tags provide context for household usage during a period. NewinMeter cannot identify the exact consumption of
          an individual appliance without device-level monitoring.
        </p>
      </div>

      <ChartShell
        title="Tagged usage"
        eyebrow={activityMetricOptions.find((option) => option.value === metric)?.label}
        action={
          <DropdownSelect
            ariaLabel="Activity metric"
            className="w-48"
            value={metric}
            options={activityMetricOptions}
            onChange={(value) => setMetric(value as ActivityMetric)}
          />
        }
      >
        {isLoading ? (
          <div className="flex h-full items-center justify-center text-sm text-muted">Loading activity report...</div>
        ) : rows.length ? (
          <ActivityReportChart rows={rows} metric={metric} />
        ) : hasNoActivitiesEver ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <div>
              <p className="text-sm font-medium text-ink">Nothing tagged yet</p>
              <p className="mx-auto mt-1 max-w-sm text-sm text-muted">
                Tag a day or time range with what was happening, then compare your household usage during those periods.
              </p>
            </div>
            <button
              className="inline-flex h-9 items-center rounded-md bg-brandTeal px-3 text-sm font-medium text-white transition hover:brightness-110"
              onClick={() => setDialogActivity(null)}
              type="button"
            >
              Add your first activity
            </button>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted">
            No activities match these filters.
          </div>
        )}
      </ChartShell>

      <Card>
        <CardHeader
          title="Activity report"
          action={
            <p className="mt-1 text-sm text-muted">
              {rows.length} {rows.length === 1 ? "activity" : "activities"}
            </p>
          }
        />
        {error ? <p className="p-4 text-sm text-red-600">{error.message}</p> : null}
        <div className="relative">
          <div className="overflow-x-auto" ref={tableScrollRef}>
            <table className="w-full min-w-[1180px] text-left text-sm">
              <thead className="bg-accentSoft text-xs uppercase tracking-[0.12em] text-brandTeal dark:text-accent">
                <tr>
                  {[
                    "Date",
                    "Time",
                    "Tags",
                    "Duration",
                    "Electricity usage",
                    "Average demand",
                    "Electricity spend",
                    "Water usage",
                    "Water spend",
                    "Note",
                    "Actions"
                  ].map((header) => (
                    <th className="px-3 py-3 font-medium" key={header}>
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((row) => (
                  <tr className="align-top hover:bg-canvas/60" key={row.id}>
                    <td className="whitespace-nowrap px-3 py-3 font-medium text-ink">{chartDate(row.date)}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-muted">{activityTimeLabel(row)}</td>
                    <td className="px-3 py-3">
                      <div className="flex max-w-52 flex-wrap gap-1">
                        {row.tags.map((tag) => (
                          <ActivityTagChip key={tag} tag={tag} />
                        ))}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-muted">
                      {formatActivityDuration(row.durationMinutes)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3">{formatKwh(row.electricityKwh)}</td>
                    <td className="whitespace-nowrap px-3 py-3">{formatActivityMetric("averageKw", row.averageKw)}</td>
                    <td className="whitespace-nowrap px-3 py-3">{formatCurrency(row.electricitySpend)}</td>
                    <td className="whitespace-nowrap px-3 py-3">{formatKl(row.waterKl)}</td>
                    <td className="whitespace-nowrap px-3 py-3">{formatCurrency(row.waterSpend)}</td>
                    <td className="max-w-60 px-3 py-3 text-muted">{row.note ?? "-"}</td>
                    <td className="px-3 py-3">
                      <div className="flex gap-2">
                        <button
                          className="text-xs text-muted hover:text-ink"
                          onClick={() => setDialogActivity(row)}
                          type="button"
                        >
                          Edit
                        </button>
                        <button
                          className="text-xs text-red-600 hover:text-red-700 disabled:opacity-50"
                          disabled={deletion.isPending}
                          onClick={() => {
                            if (window.confirm("Delete this activity? This cannot be undone.")) deletion.mutate(row.id);
                          }}
                          type="button"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ScrollHint containerRef={tableScrollRef} />
        </div>
        {!rows.length && !isLoading && !hasNoActivitiesEver ? (
          <p className="p-6 text-center text-sm text-muted">Add an activity or adjust the filters to build a report.</p>
        ) : null}
        {deletion.error ? (
          <p className="border-t border-line p-3 text-sm text-red-600">{deletion.error.message}</p>
        ) : null}
      </Card>

      <ActivityDialog
        activity={dialogActivity ?? undefined}
        isOpen={dialogActivity !== undefined}
        onClose={() => setDialogActivity(undefined)}
      />
    </div>
  );
}
