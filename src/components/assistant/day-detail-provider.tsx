"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { DayBreakdownChart } from "@/components/charts/day-breakdown-chart";
import { fetchDailyRollups } from "@/lib/dashboard-client";

// Global launcher for the SAME Day Detail dialog the dashboard and
// Activities pages already use (see DayBreakdownChart's hideInlineCard/
// autoExpand dialog-mode API) -- mounted once at the app shell so the
// assistant's `open_day_detail` action can open it from anywhere, without
// touching either page's own local implementation. `globalDomains` is
// deliberately omitted (it's optional on DayBreakdownChartProps): this
// provider has no reason to also fetch the full dashboard summary just to
// compute chart axis domains for a dialog that's only open occasionally.

type DayDetailState = {
  openDayDetail: (date: string) => void;
};

const DayDetailContext = createContext<DayDetailState | null>(null);

export function DayDetailProvider({
  activitiesEnabled = false,
  children
}: {
  activitiesEnabled?: boolean;
  children: ReactNode;
}) {
  const [dayDetailDate, setDayDetailDate] = useState<string | null>(null);

  // Lazy: only fetched the first time an open_day_detail action is actually
  // used. Full account history (no from/to) rather than the assistant's own
  // current scope, since the model can point at ANY date, not just one
  // inside whatever range the conversation happens to be scoped to.
  const { data } = useQuery({
    queryKey: ["assistant-day-detail-rollups"],
    queryFn: () => fetchDailyRollups({}),
    enabled: dayDetailDate !== null
  });
  const dailyRows = useMemo(() => data?.rows ?? [], [data?.rows]);
  const dateOptions = useMemo(
    () => Array.from(new Set(dailyRows.map((row) => row.periodDate))).sort((left, right) => left.localeCompare(right)),
    [dailyRows]
  );

  const value = useMemo<DayDetailState>(() => ({ openDayDetail: (date: string) => setDayDetailDate(date) }), []);

  return (
    <DayDetailContext.Provider value={value}>
      {children}
      {dayDetailDate ? (
        <DayBreakdownChart
          activitiesEnabled={activitiesEnabled}
          autoExpand
          dailyRows={dailyRows}
          dateOptions={dateOptions}
          hideInlineCard
          onCloseDialog={() => setDayDetailDate(null)}
          onSelectedDateChange={setDayDetailDate}
          selectedDate={dayDetailDate}
        />
      ) : null}
    </DayDetailContext.Provider>
  );
}

export function useDayDetail(): DayDetailState {
  const context = useContext(DayDetailContext);
  if (!context) {
    throw new Error("useDayDetail must be used within a DayDetailProvider");
  }
  return context;
}
