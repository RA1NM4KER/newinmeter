"use client";

import { formatLoad } from "@/lib/live-meter-calc";
import type { EstimateState } from "@/lib/live-meter-types";

type LiveHeroProps = {
  estimatedWatts: number | null;
  estimateState: EstimateState;
  agoText: string | null;
  changeText: string | null;
  hasAnyPulse: boolean;
  flash: boolean;
};

// Factual activity indicator -- reports when the last pulse was seen, never
// "online/offline" (absence of pulses can just mean low usage). Muted when
// stale.
function ActivityDot({ fresh, flash }: { fresh: boolean; flash: boolean }) {
  return (
    <span className="relative flex h-2 w-2">
      {flash && fresh ? (
        <span className="absolute inline-flex h-full w-full rounded-full bg-accent motion-safe:animate-livePing" />
      ) : null}
      <span
        className={`relative inline-flex h-2 w-2 rounded-full ${
          fresh ? "bg-accent shadow-[0_0_0_4px_rgba(76,201,142,0.14)]" : "bg-muted/60"
        }`}
      />
    </span>
  );
}

export function LiveHero({ estimatedWatts, estimateState, agoText, changeText, hasAnyPulse, flash }: LiveHeroProps) {
  // Not enough data yet to estimate power (0 or 1 pulse).
  if (estimateState === "waiting" || estimatedWatts === null) {
    return (
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">Current load</p>
        <p className="mt-2 text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
          {hasAnyPulse ? "Waiting for enough pulse data" : "Waiting for meter pulses"}
        </p>
        <p className="mt-2 max-w-md text-sm text-muted">
          {hasAnyPulse
            ? "One reading so far. An estimated load appears once a second pulse gives us an interval to measure."
            : "Your estimated load and graph appear here as soon as pulses start arriving from the meter."}
        </p>
        {hasAnyPulse && agoText ? (
          <div className="mt-3 flex items-center gap-2 text-sm text-muted">
            <ActivityDot fresh={false} flash={false} />
            Last pulse {agoText}
          </div>
        ) : null}
      </div>
    );
  }

  const fresh = estimateState === "fresh";
  const load = formatLoad(estimatedWatts);

  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">
        {fresh ? "Current load" : "Last recorded load"}
      </p>

      {/* key on the value so a settled update replays the subtle rise. */}
      <div key={estimatedWatts} className="mt-1.5 flex items-baseline gap-2 motion-safe:animate-liveRise">
        <span className="text-[2.75rem] font-bold leading-[0.96] tracking-tight tabular-nums text-ink sm:text-6xl">
          {load.value}
        </span>
        <span className="text-xl font-semibold text-muted sm:text-2xl">{load.unit}</span>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm text-muted">
        <span className={`inline-flex items-center gap-2 font-medium ${fresh ? "text-ink" : "text-muted"}`}>
          <ActivityDot fresh={fresh} flash={flash} />
          Last pulse {agoText ?? "-"}
        </span>
        {fresh && changeText ? (
          <>
            <span aria-hidden="true">·</span>
            <span className="font-medium text-brandTeal dark:text-accent">{changeText}</span>
          </>
        ) : null}
      </div>

      {!fresh ? (
        <p className="mt-2 max-w-md text-xs text-muted">
          No recent pulses. This is the last load estimate recorded by the optical reader.
        </p>
      ) : null}
    </div>
  );
}
