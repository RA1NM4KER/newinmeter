export const ASSISTANT_TIME_ZONE = "Africa/Johannesburg";

const localDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: ASSISTANT_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

const localDateTimeFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: ASSISTANT_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23"
});

export function addCalendarDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

export function buildAssistantTemporalContext(now = new Date()) {
  const today = localDateFormatter.format(now);
  return {
    timeZone: ASSISTANT_TIME_ZONE,
    currentLocalDateTime: localDateTimeFormatter.format(now).replace(", ", "T"),
    currentLocalDate: today,
    today,
    yesterday: addCalendarDays(today, -1)
  };
}
