"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { buildLiveOverviewUrl } from "@/lib/endpoints";
import { formatLiveKwh, formatMinuteChange, formatPulseAgo, pulseAgeMs } from "@/lib/live-format";
import { DEFAULT_LIVE_WINDOW } from "@/lib/live-meter-calc";
import type { LiveOverview, LiveWindow } from "@/lib/live-meter-types";
import { LIVE_FALLBACK_POLL_MS } from "@/lib/live-realtime";
import { LiveChart } from "./live-chart";
import { LivePageHeader } from "./live-page-header";
import { LiveHero } from "./live-hero";
import { WindowSelector } from "./window-selector";
import { useLiveRealtime } from "./use-live-realtime";

const LIVE_QUERY_KEY = "live-overview";

const WINDOW_LABELS: Record<LiveWindow, string> = {
  "15m": "15 minutes",
  "30m": "30 minutes",
  "1h": "1 hour",
  "6h": "6 hours"
};

async function fetchLiveOverview(window: LiveWindow): Promise<LiveOverview> {
  const response = await fetch(buildLiveOverviewUrl(window), { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to load live overview (${response.status}).`);
  }
  return (await response.json()) as LiveOverview;
}

export type LivePageClientProps = {
  // The authenticated user's id, passed from the server page. Used only to
  // build this user's own private Realtime topic (not a secret).
  userId?: string | null;
};

function RecentCell({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="min-w-0 px-3 py-3.5 sm:px-5">
      <p className="truncate text-[0.7rem] font-semibold text-muted sm:text-xs">{label}</p>
      <p className="mt-1.5 truncate text-lg font-bold tracking-tight tabular-nums text-ink sm:text-[1.375rem]">
        {value}
      </p>
      <p className="mt-1 text-[0.65rem] text-muted sm:text-[0.7rem]">{detail}</p>
    </div>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <Card className="flex flex-col items-center px-6 py-16 text-center">
      <p className="text-lg font-semibold text-ink">{title}</p>
      <p className="mt-2 max-w-sm text-sm text-muted">{body}</p>
    </Card>
  );
}

function LoadingState() {
  return (
    <div className="flex flex-col gap-4">
      <Card className="overflow-hidden">
        <div className="flex flex-col gap-4 px-4 pt-5 sm:flex-row sm:items-start sm:justify-between sm:px-6">
          <div>
            <Skeleton className="h-3 w-24" />
            <Skeleton className="mt-3 h-12 w-40" />
            <Skeleton className="mt-3 h-4 w-52" />
          </div>
          <Skeleton className="h-9 w-full rounded-lg sm:w-56" />
        </div>
        <Skeleton className="mx-4 mt-4 h-[280px] rounded-lg sm:mx-6 sm:h-[300px]" />
        <div className="px-4 py-4 sm:px-6">
          <Skeleton className="h-3 w-72 max-w-full" />
        </div>
      </Card>
      <Skeleton className="h-24 w-full rounded-lg" />
    </div>
  );
}

export function LivePageClient({ userId }: LivePageClientProps = {}) {
  const [window, setWindow] = useState<LiveWindow>(DEFAULT_LIVE_WINDOW);
  const [tick, setTick] = useState(0);
  const [flash, setFlash] = useState(false);
  const prevPulseRef = useRef<string | null>(null);
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: [LIVE_QUERY_KEY, window],
    queryFn: () => fetchLiveOverview(window),
    // Realtime broadcast drives updates; this is only a slow fallback for a
    // missed event or a dropped socket.
    refetchInterval: LIVE_FALLBACK_POLL_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    // Keep the last good data on screen during a refetch or window switch, so
    // the page never blanks or flickers.
    placeholderData: keepPreviousData,
    staleTime: 4000,
    retry: 1
  });

  // On a broadcast (or on (re)subscribe), refetch the authoritative overview.
  // Stable identity so the realtime subscription isn't torn down/rebuilt.
  const handlePulsesChanged = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: [LIVE_QUERY_KEY] });
  }, [queryClient]);

  useLiveRealtime(userId, handlePulsesChanged);

  const data = query.data;

  // Re-render "last pulse X ago" every second without hitting the API.
  useEffect(() => {
    const id = setInterval(() => setTick((value) => value + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const lastPulseAt = data?.latest.lastPulseAt ?? null;

  // Flash the activity dot when a newer pulse appears between polls.
  useEffect(() => {
    if (!lastPulseAt) {
      return;
    }
    if (prevPulseRef.current && prevPulseRef.current !== lastPulseAt) {
      setFlash(true);
      const id = setTimeout(() => setFlash(false), 1000);
      prevPulseRef.current = lastPulseAt;
      return () => clearTimeout(id);
    }
    prevPulseRef.current = lastPulseAt;
  }, [lastPulseAt]);

  // `tick` drives the per-second recompute. pulseAgeMs guards the window where
  // dataUpdatedAt is still 0 (new query key loading with placeholder data),
  // which otherwise made "last pulse" jump to thousands of hours.
  const agoText = useMemo(() => {
    const ageMs = pulseAgeMs(data?.generatedAt ?? null, lastPulseAt, query.dataUpdatedAt, Date.now());
    return ageMs === null ? null : formatPulseAgo(ageMs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastPulseAt, data?.generatedAt, query.dataUpdatedAt, tick]);

  // Initial load only -- background refetches keep the previous data visible.
  if (query.isLoading && !data) {
    return (
      <div className="mx-auto w-full max-w-5xl">
        <LivePageHeader />
        <LoadingState />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="mx-auto w-full max-w-5xl">
        <LivePageHeader />
        <EmptyState
          title="Live data unavailable"
          body="We couldn't load your live meter data just now. It will retry automatically."
        />
      </div>
    );
  }

  if (!data.device) {
    return (
      <div className="mx-auto w-full max-w-5xl">
        <LivePageHeader />
        <EmptyState
          title="No live meter reader is configured yet"
          body="Once a meter reader is set up for your account, your near-live electricity usage will appear here."
        />
      </div>
    );
  }

  const { latest, energy, series } = data;
  const hasAnyPulse = latest.lastPulseAt !== null;
  const isStale = latest.estimateState === "stale";
  const changeText = formatMinuteChange(latest.changeWattsLastMinute);
  const refetchFailing = query.isError; // last good data retained on screen

  return (
    <div className="mx-auto w-full max-w-5xl pb-6">
      <LivePageHeader />

      {/* Accessible, colour-independent summary of the current state. */}
      <p className="sr-only">
        {latest.estimatedWatts !== null
          ? `${isStale ? "Last recorded load" : "Current load"} approximately ${latest.estimatedWatts} watts.`
          : "Estimated load not available yet."}
        {agoText ? ` Last pulse ${agoText}.` : " No pulses recorded yet."}
      </p>

      {refetchFailing ? (
        <p role="status" className="mb-3 text-xs text-amber-700 dark:text-amber-400">
          Live data temporarily unavailable. Showing the last reading.
        </p>
      ) : null}

      {/* ONE instrument: current load and graph in a single card. */}
      <Card className="overflow-hidden">
        <div className="flex flex-col gap-4 px-4 pt-5 sm:flex-row sm:items-start sm:justify-between sm:px-6">
          <LiveHero
            estimatedWatts={latest.estimatedWatts}
            estimateState={latest.estimateState}
            agoText={agoText}
            changeText={changeText}
            hasAnyPulse={hasAnyPulse}
            flash={flash}
          />
          <div className="shrink-0">
            <WindowSelector value={window} onChange={setWindow} />
          </div>
        </div>

        <div className="mt-3 h-[280px] px-1 sm:mt-4 sm:h-[320px] sm:px-3">
          <LiveChart series={series} muted={isStale} />
        </div>

        <p className="px-4 pb-4 pt-2 text-xs text-muted sm:px-6">
          Estimated load from recent meter pulse intervals · {WINDOW_LABELS[window]} · updates as new pulses arrive
        </p>
      </Card>

      {/* ONE supporting strip -- three columns on desktop, stacked on mobile. */}
      <div className="mt-4 grid grid-cols-3 divide-x divide-line overflow-hidden rounded-lg border border-line bg-paper/88">
        <RecentCell label="Last 5 minutes" value={formatLiveKwh(energy.last5MinutesKwh)} detail="Optical pulse total" />
        <RecentCell label="Last hour" value={formatLiveKwh(energy.lastHourKwh)} detail="Optical pulse total" />
        <RecentCell label="Last pulse" value={agoText ?? "-"} detail="Not a device-online indicator" />
      </div>

      <p className="mt-3.5 px-1 text-xs text-muted">
        Optical meter data · Independent of LiveMopay · Not used for billing or balances
      </p>
    </div>
  );
}
