// Pure presentation helpers for the Live page. Kept dependency-free so the
// "last pulse X ago" text (which the client re-renders every second) is
// deterministically testable.

// Age of the last pulse, anchored on the server clock (generatedAt vs
// lastPulseAt) plus the local time elapsed since this data arrived -- so it
// stays correct even with a skewed browser clock and ticks up between polls.
//
// `dataUpdatedAtMs` is React Query's `dataUpdatedAt`. It is 0 while a new query
// key is still loading (e.g. right after switching the time window, when
// keepPreviousData is showing the old data). In that window `Date.now() - 0`
// would be ~epoch-millis and make "last pulse" balloon to thousands of hours,
// so we add no local elapsed until a real anchor exists. Returns null when
// there is no pulse to age.
export function pulseAgeMs(
  generatedAtIso: string | null | undefined,
  lastPulseAtIso: string | null | undefined,
  dataUpdatedAtMs: number,
  nowMs: number
): number | null {
  if (!generatedAtIso || !lastPulseAtIso) {
    return null;
  }
  const serverAge = Date.parse(generatedAtIso) - Date.parse(lastPulseAtIso);
  if (!Number.isFinite(serverAge)) {
    return null;
  }
  const localElapsed = dataUpdatedAtMs > 0 ? Math.max(0, nowMs - dataUpdatedAtMs) : 0;
  return Math.max(0, serverAge + localElapsed);
}

// Compact "time since" phrasing for the last pulse. Clamps negatives to 0
// (a slightly-ahead client clock should read "just now", not a future time).
export function formatPulseAgo(ageMs: number): string {
  const seconds = Math.max(0, Math.floor(ageMs / 1000));
  if (seconds < 1) {
    return "just now";
  }
  if (seconds < 60) {
    return `${seconds}s ago`;
  }

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }

  return `${Math.floor(hours / 24)}d ago`;
}

// en-US so the decimal separator is a dot, matching the hero value (which uses
// toFixed) -- the Live surface reads consistently as "3.23 kW" / "0.27 kWh".
const liveKwhFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 3
});

// kWh at the meter's pulse resolution (1 Wh = 0.001 kWh), so a small-but-real
// figure like 0.004 kWh isn't rounded away to "0". Trims trailing zeros:
// 2.84 -> "2.84 kWh", 0.004 -> "0.004 kWh", 0 -> "0 kWh".
export function formatLiveKwh(value: number): string {
  return `${liveKwhFormatter.format(value)} kWh`;
}

// Restrained signed change vs a minute ago, e.g. "↑ 1.84 kW in the last
// minute". Returns null for a negligible change so tiny jitter isn't shown as
// movement.
export function formatMinuteChange(changeWatts: number | null): string | null {
  if (changeWatts === null || Math.abs(changeWatts) < 50) {
    return null;
  }
  const arrow = changeWatts > 0 ? "↑" : "↓";
  const magnitude = Math.abs(changeWatts);
  const text = magnitude >= 1000 ? `${(magnitude / 1000).toFixed(2)} kW` : `${Math.round(magnitude)} W`;
  return `${arrow} ${text} in the last minute`;
}

// Local wall-clock HH:MM for chart axis ticks and tooltips.
export function formatClockTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
