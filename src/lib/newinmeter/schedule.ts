import "server-only";

// Deterministic scheduling for automatic LiveMopay syncs. Pure functions
// only -- no I/O, no randomness -- so the whole module is trivially unit
// testable and safe to call from both the toggle route (Settings) and the
// auto-sync worker.
//
// LiveMopay electricity data arrives in roughly four ~6-hour batches a day,
// so four fixed local windows are enough: contacting LiveMopay more often
// than that just polls for data that isn't there yet.

export const AUTO_SYNC_TIME_ZONE = "Africa/Johannesburg";

// Minutes since local midnight for each daily window: 05:15, 12:15, 18:15,
// 23:15. Kept as a plain exported array (not hardcoded inside the
// calculation function) so a future personalization pass could compute a
// per-connection window list from historical LiveMopay capture timing and
// pass it into computeNextAutoSyncAt() instead of this default -- without
// changing the function's contract.
export const AUTO_SYNC_DEFAULT_WINDOWS_MINUTES: readonly number[] = [
  5 * 60 + 15, // 05:15
  12 * 60 + 15, // 12:15
  18 * 60 + 15, // 18:15
  23 * 60 + 15 // 23:15
];

// Every connection's exact time within a window is offset by up to this many
// minutes either side, so not every connection contacts LiveMopay at exactly
// :15. The offset is the same for a given connection across every window
// (see connectionOffsetMinutes) -- simplest thing that satisfies "stable for
// a given connection" and "distributed across users" without needing a
// separate deterministic value per window.
export const AUTO_SYNC_JITTER_MINUTES = 10;

// Modest, fixed retry delay for a retryable automatic-sync failure (network
// blip, upstream 5xx, timeout). Deliberately not "try again next 5-minute
// tick" (too aggressive for a third-party service we want to be polite to)
// and not "wait for the next 6-hour window" (too slow to recover from a
// one-off blip) -- a single flat middle ground that still self-corrects onto
// the normal 4-window grid the moment a sync actually succeeds.
export const AUTO_SYNC_RETRY_BACKOFF_MINUTES = 30;

const MINUTE_MS = 60_000;

// djb2. Only needs to be a stable, well-distributed, non-cryptographic hash
// of a UUID string -- not Math.random(), so the same connection always maps
// to the same offset and different connections spread out across the
// window.
function stableStringHash(value: string): number {
  let hash = 5381;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 33) ^ value.charCodeAt(i);
  }
  // >>> 0 folds the signed 32-bit result into an unsigned range.
  return hash >>> 0;
}

// Deterministic per-connection offset in
// [-AUTO_SYNC_JITTER_MINUTES, +AUTO_SYNC_JITTER_MINUTES], reused for every
// window that connection is scheduled into.
export function connectionOffsetMinutes(connectionId: string): number {
  const span = AUTO_SYNC_JITTER_MINUTES * 2 + 1;
  return (stableStringHash(connectionId) % span) - AUTO_SYNC_JITTER_MINUTES;
}

type LocalDateParts = { year: number; month: number; day: number };

// en-CA's default format is exactly "YYYY-MM-DD", matching Postgres date
// literals and energy_day_rollups.period_date -- no manual zero-padding.
const localDateStringFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: AUTO_SYNC_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

// Today's calendar date in Africa/Johannesburg, as "YYYY-MM-DD" -- the dedup
// key daily alert events (daily_spend, daily_kwh) are scoped by. Always
// SAST, never UTC, so a threshold crossing near midnight lands on the
// correct local day rather than drifting by the UTC+2 offset.
export function currentLocalDateString(now: Date): string {
  return localDateStringFormatter.format(now);
}

function localDateParts(date: Date, timeZone: string): LocalDateParts {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day) };
}

// How many minutes to ADD to a UTC instant to get that same instant's wall
// clock in `timeZone`. Recomputed from the actual instant (not hardcoded)
// so this stays correct even for a zone with DST -- Africa/Johannesburg
// currently has none, so this is always +120, but nothing here assumes
// that.
function zonedOffsetMinutes(instant: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
  const parts = Object.fromEntries(formatter.formatToParts(instant).map((part) => [part.type, part.value]));
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) === 24 ? 0 : Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
  return (asUtc - instant.getTime()) / MINUTE_MS;
}

// Converts a local calendar date + minutes-since-midnight in `timeZone` into
// the absolute UTC instant it represents. Two-pass: guess the offset by
// treating the wall-clock value as if it were UTC, then correct using the
// zone's actual offset at that guessed instant.
function zonedTimeToUtc(parts: LocalDateParts, minutesSinceMidnight: number, timeZone: string): Date {
  const guess = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day, 0, minutesSinceMidnight, 0)
  );
  const offset = zonedOffsetMinutes(guess, timeZone);
  return new Date(guess.getTime() - offset * MINUTE_MS);
}

function addDays(parts: LocalDateParts, days: number): LocalDateParts {
  // Date.UTC normalizes out-of-range days/months for us (e.g. day 32 rolls
  // into the next month), so this stays correct across month/year
  // boundaries without any manual calendar arithmetic.
  const asUtc = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return { year: asUtc.getUTCFullYear(), month: asUtc.getUTCMonth() + 1, day: asUtc.getUTCDate() };
}

export type AutoSyncScheduleOptions = {
  timeZone?: string;
  windowsMinutes?: readonly number[];
};

// The next deterministic scheduled sync instant for this connection,
// strictly after `now`. Always lands on one of the fixed daily windows
// (offset by this connection's stable jitter), never on an arbitrary
// "now + 6h" -- that's what keeps every connection's schedule anchored to
// the same four daily windows indefinitely instead of drifting after a
// failure, a delayed tick, or a deployment.
export function computeNextAutoSyncAt(
  connectionId: string,
  now: Date,
  options: AutoSyncScheduleOptions = {}
): Date {
  const timeZone = options.timeZone ?? AUTO_SYNC_TIME_ZONE;
  const windowsMinutes = options.windowsMinutes ?? AUTO_SYNC_DEFAULT_WINDOWS_MINUTES;
  const offset = connectionOffsetMinutes(connectionId);
  const today = localDateParts(now, timeZone);

  const todaysCandidates = windowsMinutes
    .map((windowMinutes) => zonedTimeToUtc(today, windowMinutes + offset, timeZone))
    .sort((a, b) => a.getTime() - b.getTime());

  const next = todaysCandidates.find((candidate) => candidate.getTime() > now.getTime());
  if (next) {
    return next;
  }

  // Every window today has already passed -- roll to tomorrow's earliest
  // window (e.g. after 23:15 rolls to next day's 05:15).
  const tomorrow = addDays(today, 1);
  const earliestWindowMinutes = [...windowsMinutes].sort((a, b) => a - b)[0];
  return zonedTimeToUtc(tomorrow, earliestWindowMinutes + offset, timeZone);
}

// Next retry instant for a retryable automatic-sync failure -- a flat
// backoff from "now" (when the failure was recorded), not tied to the
// window grid at all.
export function computeAutoSyncRetryAt(now: Date): Date {
  return new Date(now.getTime() + AUTO_SYNC_RETRY_BACKOFF_MINUTES * MINUTE_MS);
}
