// Client-safe relative-time formatting for the notification centre.
//
// Deliberately NOT imported from schedule.ts's currentLocalDateString --
// that module starts with `import "server-only"`, so pulling it into a
// client component would break the build. This is a few lines duplicated
// for a real module-boundary reason, not carelessness.
//
// Also deliberately not a source of hydration mismatch: this only ever
// runs on notification rows, which are fetched and rendered entirely
// client-side (never part of the initial server-rendered HTML) -- there is
// no server-rendered version of this text to disagree with. See the
// Alerts v1 deploy's one transient hydration incident for why this is
// called out explicitly rather than assumed safe.
const SAST_DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Africa/Johannesburg",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

function sastDateString(date: Date): string {
  return SAST_DATE_FORMATTER.format(date);
}

// Calendar-day difference in Africa/Johannesburg, used once an event is a
// full day or more old -- "Yesterday" and "N days ago" are calendar
// concepts, not raw 24h multiples.
function calendarDayDiff(from: Date, to: Date): number {
  const fromParts = sastDateString(from).split("-").map(Number);
  const toParts = sastDateString(to).split("-").map(Number);
  const fromUtc = Date.UTC(fromParts[0], fromParts[1] - 1, fromParts[2]);
  const toUtc = Date.UTC(toParts[0], toParts[1] - 1, toParts[2]);
  return Math.round((toUtc - fromUtc) / 86_400_000);
}

export function formatNotificationTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const diffMs = now.getTime() - then.getTime();
  const diffMinutes = Math.floor(diffMs / 60_000);

  if (diffMinutes < 1) {
    return "Just now";
  }
  if (diffMinutes < 60) {
    return `${diffMinutes} min ago`;
  }

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours} hr ago`;
  }

  const dayDiff = calendarDayDiff(then, now);
  if (dayDiff <= 1) {
    return "Yesterday";
  }
  return `${dayDiff} days ago`;
}
