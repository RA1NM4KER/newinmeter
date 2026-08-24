"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ACTIVITY_TAGS_DISCLAIMER, activityTabs } from "./activity-tabs";
import {
  ACTIVITY_REPORT_DEFAULT_DIRECTION,
  ACTIVITY_REPORT_DEFAULT_SORT,
  activityReportColumns,
  sortActivityReportRows,
  type ActivityReportSortKey
} from "./activity-report-columns";
import { ActivityDashboardTab } from "./activity-dashboard-tab";
import { ActivityReportTable } from "./activity-report-table";
import { ActivityExportButton } from "./activity-export-button";
import { ActivityDialog } from "./activity-dialog";
import { TagFilter } from "./tag-filter";
import { DayBreakdownChart } from "@/components/charts/day-breakdown-chart";
import { FilterBar } from "@/components/dashboard/filter-bar";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { UnderlineTabs } from "@/components/ui/underline-tabs";
import { buildActivitySearchParams, parseActivityQuery, replaceActivityTagParams } from "@/lib/activity/query-params";
import { fetchActivityReport, fetchActivityTags } from "@/lib/activity/client";
import { ACTIVITIES_TAB_CHANGE_EVENT } from "@/lib/activity/tab-event";
import { fetchDailyRollups } from "@/lib/dashboard-client";
import { buildGlobalDomainsFromSummary } from "@/lib/day-breakdown";
import { useFilterUrlState } from "@/lib/url-state/use-filter-url-state";
import { queryHref } from "@/lib/url-query";
import type { ActivityMetric, ActivityReportRow, DashboardSummary, UsageActivity } from "@/lib/types";

export function ActivitiesPageClient({
  bounds,
  summary: dashboardSummary
}: {
  bounds: { from?: string; to?: string };
  summary: DashboardSummary;
}) {
  const { from, to, quickRange, isPending, onDateChange, onQuickRange } = useFilterUrlState(bounds);
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTagTransition] = useTransition();
  const selectedTags = useMemo(
    () => parseActivityQuery(new URLSearchParams(searchParams.toString())).tags,
    [searchParams]
  );
  const [activeTab, setActiveTabState] = useState<"dashboard" | "table">(() =>
    searchParams.get("tab") === "table" ? "table" : "dashboard"
  );
  const sortableColumnIds = useMemo(
    () => new Set<string>(activityReportColumns.filter((column) => column.sortable).map((column) => column.id)),
    []
  );
  const requestedSortKey = searchParams.get("sort");
  const sortKey = (
    requestedSortKey && sortableColumnIds.has(requestedSortKey) ? requestedSortKey : ACTIVITY_REPORT_DEFAULT_SORT
  ) as ActivityReportSortKey;
  const sortDirection = searchParams.get("dir") === "asc" ? "asc" : ACTIVITY_REPORT_DEFAULT_DIRECTION;
  const [metric, setMetric] = useState<ActivityMetric>("electricityKwh");
  const [dialogActivity, setDialogActivity] = useState<UsageActivity | null | undefined>(undefined);
  // Prefill from a usage_anomaly notification's deep link
  // (/activities?new=1&date=...&start=...&end=...&source=usage-alert) --
  // consumed once on mount, then stripped from the URL so a later manual
  // "+ Add activity" click doesn't silently reuse a stale time range.
  const [deepLinkPrefill, setDeepLinkPrefill] = useState<{ date?: string; startTime?: string; endTime?: string } | null>(
    null
  );
  const handledDeepLinkRef = useRef(false);
  const [dayDetailDate, setDayDetailDate] = useState<string | null>(null);

  useEffect(() => {
    if (handledDeepLinkRef.current) return;
    handledDeepLinkRef.current = true;
    if (searchParams.get("new") !== "1") return;

    setDeepLinkPrefill({
      date: searchParams.get("date") ?? undefined,
      startTime: searchParams.get("start") ?? undefined,
      endTime: searchParams.get("end") ?? undefined
    });
    setDialogActivity(null);

    const next = new URLSearchParams(searchParams.toString());
    next.delete("new");
    next.delete("date");
    next.delete("start");
    next.delete("end");
    next.delete("source");
    window.history.replaceState(window.history.state, "", queryHref(pathname, next));
    // Deliberately run once on mount only -- searchParams/pathname are read
    // from their values at that instant, not re-run as the URL changes
    // (including from the replaceState call inside this very effect).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Lazy: only fetched once "Jump to day detail" is actually clicked, scoped
  // to the same range already on screen rather than the account's full
  // history (that's what the main dashboard needs it for; this dialog only
  // ever shows one day within the current filter).
  const { data: dailyRollupsData } = useQuery({
    queryKey: ["daily-rollups", from, to],
    queryFn: () => fetchDailyRollups({ from, to }),
    enabled: dayDetailDate !== null && Boolean(from && to)
  });
  const dailyRollups = useMemo(() => dailyRollupsData?.rows ?? [], [dailyRollupsData?.rows]);
  const dayDetailDateOptions = useMemo(
    () =>
      Array.from(new Set(dailyRollups.map((row) => row.periodDate))).sort((left, right) => left.localeCompare(right)),
    [dailyRollups]
  );
  const dayDetailGlobalDomains = buildGlobalDomainsFromSummary(dashboardSummary);
  const filters = useMemo(() => ({ from, to, tags: selectedTags }), [from, selectedTags, to]);
  const { data, isLoading, error } = useQuery({
    queryKey: ["activity-report", filters],
    queryFn: () => fetchActivityReport(filters),
    enabled: Boolean(from && to)
  });
  const { data: tagsData } = useQuery({ queryKey: ["activity-tags"], queryFn: fetchActivityTags });
  const rows = useMemo(() => data?.rows ?? [], [data?.rows]);
  // The chart stays chronological regardless of the table's sort -- only the
  // table itself reflects it.
  const sortedRows = useMemo(
    () => sortActivityReportRows(rows, sortKey, sortDirection),
    [rows, sortKey, sortDirection]
  );
  const summary = data?.summary;
  const exportParams = buildActivitySearchParams({ ...filters, metric });
  // Every activity requires at least one tag (see validateActivityInput), so
  // an empty tag vocabulary -- once it's actually loaded -- means the
  // account has never had a single activity, regardless of the current
  // date/tag filters. That's the signal for "first-time" vs. "your filters
  // just don't match anything".
  const hasNoActivitiesEver = tagsData !== undefined && tagsData.tags.length === 0;

  const updateSelectedTags = (tags: string[]) => {
    const next = replaceActivityTagParams(new URLSearchParams(searchParams.toString()), tags);
    // searchParams here can be stale on "tab" -- setActiveTab updates the
    // URL directly (bypassing the router) to skip a server round-trip, so
    // reassert the current tab from local state rather than trusting it.
    if (activeTab === "dashboard") next.delete("tab");
    else next.set("tab", activeTab);
    startTagTransition(() => {
      router.replace(queryHref(pathname, next), { scroll: false });
    });
  };

  // Tab switch is purely a client-side view toggle -- the report data is
  // already cached (see the `activity-report` query above), so this must
  // never go through router.replace. That would re-run the whole
  // force-dynamic server tree (auth/connection/permissions/summary) just to
  // flip a tab. Update the URL directly instead, bypassing Next's router.
  const setActiveTab = (tab: string) => {
    const nextTab = tab === "table" ? "table" : "dashboard";
    const next = new URLSearchParams(searchParams.toString());
    if (nextTab === "dashboard") {
      next.delete("tab");
    } else {
      next.set("tab", nextTab);
    }
    window.history.replaceState(window.history.state, "", queryHref(pathname, next));
    window.dispatchEvent(new CustomEvent(ACTIVITIES_TAB_CHANGE_EVENT, { detail: nextTab }));
    setActiveTabState(nextTab);
  };

  const onSortChange = (key: ActivityReportSortKey) => {
    const nextDirection =
      key === sortKey ? (sortDirection === "asc" ? "desc" : "asc") : ACTIVITY_REPORT_DEFAULT_DIRECTION;
    const next = new URLSearchParams(searchParams.toString());
    if (key === ACTIVITY_REPORT_DEFAULT_SORT) next.delete("sort");
    else next.set("sort", key);
    if (nextDirection === ACTIVITY_REPORT_DEFAULT_DIRECTION) next.delete("dir");
    else next.set("dir", nextDirection);
    if (activeTab === "dashboard") next.delete("tab");
    else next.set("tab", activeTab);
    router.replace(queryHref(pathname, next), { scroll: false });
  };

  // From a tagged-usage chart hover card: open that day's detail chart as a
  // dialog right here, so closing it leaves you on Activities to check
  // another day rather than bouncing to the main dashboard.
  const handleJumpToDay = (activity: ActivityReportRow) => {
    setDayDetailDate(activity.date);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 pt-6">
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
        extraControls={<TagFilter tags={tagsData?.tags ?? []} selected={selectedTags} onChange={updateSelectedTags} />}
        rightControls={<ActivityExportButton params={exportParams} />}
        splitMobileRow
        fullBleed
        sticky
      />

      <div className="hidden sm:block">
        <h1 className="text-xl font-semibold text-ink">Activities</h1>
        <p className="mt-1 text-sm text-muted">Compare household usage during the periods you tagged.</p>
      </div>

      <UnderlineTabs
        tabs={activityTabs}
        activeId={activeTab}
        onChange={setActiveTab}
        endSlot={
          <span className="pb-2 sm:hidden">
            <InfoTooltip label="About activity tags" text={ACTIVITY_TAGS_DISCLAIMER} />
          </span>
        }
      />

      {activeTab === "dashboard" ? (
        <ActivityDashboardTab
          summary={summary}
          rows={rows}
          isLoading={isLoading}
          hasNoActivitiesEver={hasNoActivitiesEver}
          metric={metric}
          onMetricChange={setMetric}
          onAddActivity={() => setDialogActivity(null)}
          onEditActivity={setDialogActivity}
          onJumpToDay={handleJumpToDay}
        />
      ) : (
        // Pulled up over the gap-5 the parent flex column puts above every
        // child, so the table sits closer to the tabs on mobile -- desktop
        // (and the Dashboard tab) keep the normal spacing.
        <div className="-mt-3 flex min-h-0 flex-1 flex-col sm:mt-0">
          <ActivityReportTable
            rows={sortedRows}
            error={error}
            isLoading={isLoading}
            hasNoActivitiesEver={hasNoActivitiesEver}
            onEdit={setDialogActivity}
            sortKey={sortKey}
            sortDirection={sortDirection}
            onSortChange={onSortChange}
          />
        </div>
      )}

      <ActivityDialog
        activity={dialogActivity ?? undefined}
        isOpen={dialogActivity !== undefined}
        onClose={() => {
          setDialogActivity(undefined);
          setDeepLinkPrefill(null);
        }}
        defaultDate={dialogActivity === null ? deepLinkPrefill?.date : undefined}
        defaultStartTime={dialogActivity === null ? deepLinkPrefill?.startTime : undefined}
        defaultEndTime={dialogActivity === null ? deepLinkPrefill?.endTime : undefined}
      />

      {dayDetailDate ? (
        <DayBreakdownChart
          activitiesEnabled
          autoExpand
          dailyRows={dailyRollups}
          dateOptions={dayDetailDateOptions}
          globalDomains={dayDetailGlobalDomains}
          hideInlineCard
          onCloseDialog={() => setDayDetailDate(null)}
          onSelectedDateChange={setDayDetailDate}
          selectedDate={dayDetailDate}
        />
      ) : null}
    </div>
  );
}
