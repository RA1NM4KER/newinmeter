import type { ActivityReportRow, UsageActivity } from "../types";

export const ACTIVITY_MAX_TAGS = 10;
export const ACTIVITY_MAX_TAG_LENGTH = 30;
export const ACTIVITY_MAX_NOTE_LENGTH = 500;
export const ACTIVITY_MAX_DURATION_MINUTES = 24 * 60;
export const DEFAULT_ACTIVITY_COLOR = "#0f766e";
export const ACTIVITY_COLOR_OPTIONS = [
  DEFAULT_ACTIVITY_COLOR,
  "#2563eb",
  "#c2410c",
  "#7c3aed",
  "#db2777",
  "#65a30d"
] as const;

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^(?:[01]\d|2[0-3]):(?:00|30)$/;
const activityColorPattern = /^#[0-9a-f]{6}$/i;

export type ActivityInput = {
  date: string;
  allDay: boolean;
  startTime?: string;
  endTime?: string;
  tags: string[];
  color?: string;
  note?: string | null;
};

export function normalizeActivityColor(value?: string | null) {
  const color = value?.trim().toLowerCase();
  return color && activityColorPattern.test(color) ? color : DEFAULT_ACTIVITY_COLOR;
}

export function normalizeActivityTag(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-ZA");
}

export function normalizeActivityTags(values: string[]) {
  return Array.from(new Set(values.map(normalizeActivityTag).filter(Boolean)));
}

export function displayActivityTag(value: string) {
  return normalizeActivityTag(value)
    .split(" ")
    .map((word) => (word ? `${word[0].toLocaleUpperCase("en-ZA")}${word.slice(1)}` : word))
    .join(" ");
}

export function isIsoDate(value: string) {
  if (!isoDatePattern.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

export function isHalfHourTime(value: string) {
  return timePattern.test(value);
}

export function addDaysToIsoDate(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day + days));
  return parsed.toISOString().slice(0, 10);
}

export function buildActivityRange(input: Pick<ActivityInput, "date" | "allDay" | "startTime" | "endTime">) {
  if (input.allDay) {
    return {
      startsAt: `${input.date}T00:00:00`,
      endsAt: `${addDaysToIsoDate(input.date, 1)}T00:00:00`
    };
  }

  const startTime = input.startTime ?? "";
  const endTime = input.endTime ?? "";
  const endDate = endTime <= startTime ? addDaysToIsoDate(input.date, 1) : input.date;
  return {
    startsAt: `${input.date}T${startTime}:00`,
    endsAt: `${endDate}T${endTime}:00`
  };
}

function localTimestampValue(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!match) return NaN;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]));
}

export function activityDurationMinutes(startsAt: string, endsAt: string) {
  return Math.round((localTimestampValue(endsAt) - localTimestampValue(startsAt)) / 60_000);
}

export function activityRangeValidationError(startsAt: string, endsAt: string, allDay: boolean) {
  const durationMinutes = activityDurationMinutes(startsAt, endsAt);
  if (durationMinutes <= 0) return "End time must be after start time.";
  if (!allDay && durationMinutes > ACTIVITY_MAX_DURATION_MINUTES) {
    return "Timed activities cannot be longer than 24 hours.";
  }
  return undefined;
}

export function activityOverlapsRange(startsAt: string, endsAt: string, rangeStart: string, rangeEnd: string) {
  return (
    localTimestampValue(startsAt) < localTimestampValue(rangeEnd) &&
    localTimestampValue(endsAt) > localTimestampValue(rangeStart)
  );
}

// Rollup timestamps denote the start of a 30-minute slot. The end boundary
// is deliberately excluded so adjacent activities never share an interval.
export function activityIncludesInterval(startsAt: string, endsAt: string, periodDate: string, periodTime: string) {
  const intervalStart = `${periodDate}T${periodTime.slice(0, 5)}:00`;
  const value = localTimestampValue(intervalStart);
  return value >= localTimestampValue(startsAt) && value < localTimestampValue(endsAt);
}

export function averageDemandKw(electricityKwh: number, durationMinutes: number) {
  return durationMinutes > 0 ? electricityKwh / (durationMinutes / 60) : 0;
}

export function aggregateActivityReportRow(
  activity: UsageActivity,
  intervals: Array<{
    periodDate: string;
    periodTime: string;
    kwh: number;
    spend: number;
    waterKl: number;
    waterSpend: number;
  }>
): ActivityReportRow {
  const included = intervals.filter((interval) =>
    activityIncludesInterval(activity.startsAt, activity.endsAt, interval.periodDate, interval.periodTime)
  );
  const durationMinutes = activityDurationMinutes(activity.startsAt, activity.endsAt);
  const electricityKwh = included.reduce((sum, row) => sum + row.kwh, 0);
  return {
    ...activity,
    date: activity.startsAt.slice(0, 10),
    durationMinutes,
    electricityKwh,
    averageKw: averageDemandKw(electricityKwh, durationMinutes),
    electricitySpend: included.reduce((sum, row) => sum + row.spend, 0),
    waterKl: included.reduce((sum, row) => sum + row.waterKl, 0),
    waterSpend: included.reduce((sum, row) => sum + row.waterSpend, 0)
  };
}

export function validateActivityInput(input: ActivityInput) {
  const errors: Record<string, string> = {};
  const tags = normalizeActivityTags(Array.isArray(input.tags) ? input.tags : []);
  const color = input.color?.trim().toLowerCase() ?? DEFAULT_ACTIVITY_COLOR;
  const note = input.note?.trim() || undefined;

  if (!isIsoDate(input.date)) errors.date = "Choose a valid date.";
  if (!input.allDay) {
    if (!input.startTime || !isHalfHourTime(input.startTime)) errors.startTime = "Choose a 30-minute start time.";
    if (!input.endTime || (!isHalfHourTime(input.endTime) && input.endTime !== "00:00")) {
      errors.endTime = "Choose a 30-minute end time.";
    }
  }
  if (!tags.length) errors.tags = "Add at least one tag.";
  if (tags.length > ACTIVITY_MAX_TAGS) errors.tags = `Use no more than ${ACTIVITY_MAX_TAGS} tags.`;
  if (tags.some((tag) => tag.length > ACTIVITY_MAX_TAG_LENGTH)) {
    errors.tags = `Tags must be ${ACTIVITY_MAX_TAG_LENGTH} characters or fewer.`;
  }
  if (!activityColorPattern.test(color)) errors.color = "Choose a valid activity colour.";
  if (note && note.length > ACTIVITY_MAX_NOTE_LENGTH) {
    errors.note = `Notes must be ${ACTIVITY_MAX_NOTE_LENGTH} characters or fewer.`;
  }

  if (!Object.keys(errors).length) {
    const range = buildActivityRange(input);
    const rangeError = activityRangeValidationError(range.startsAt, range.endsAt, input.allDay);
    if (rangeError) errors.endTime = rangeError;
  }

  return Object.keys(errors).length
    ? { success: false as const, errors }
    : { success: true as const, value: { ...input, tags, color, note } };
}

export function activityDate(activity: Pick<UsageActivity, "startsAt">) {
  return activity.startsAt.slice(0, 10);
}

export function activityTimeLabel(activity: Pick<UsageActivity, "startsAt" | "endsAt" | "allDay">) {
  if (activity.allDay) return "Whole day";
  const isNextDay = activity.endsAt.slice(0, 10) !== activity.startsAt.slice(0, 10);
  return `${activity.startsAt.slice(11, 16)} to ${activity.endsAt.slice(11, 16)}${isNextDay ? " next day" : ""}`;
}

export function activityOverlayRange(
  activity: Pick<UsageActivity, "startsAt" | "endsAt" | "allDay">,
  selectedDate: string
) {
  const dayStart = `${selectedDate}T00:00:00`;
  const dayEnd = `${addDaysToIsoDate(selectedDate, 1)}T00:00:00`;
  if (!activityOverlapsRange(activity.startsAt, activity.endsAt, dayStart, dayEnd)) return undefined;
  const startsBeforeDay = localTimestampValue(activity.startsAt) <= localTimestampValue(dayStart);
  const endsAfterDay = localTimestampValue(activity.endsAt) >= localTimestampValue(dayEnd);
  return {
    startTime: startsBeforeDay ? "00:00" : activity.startsAt.slice(11, 16),
    // The chart's final category is 23:30; midnight belongs to the next day.
    endTime: endsAfterDay ? "23:30" : activity.endsAt.slice(11, 16)
  };
}

export function formatActivityDuration(minutes: number) {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

export function deduplicatedActivitySummary(
  activities: UsageActivity[],
  intervals: Array<{
    periodDate: string;
    periodTime: string;
    kwh: number;
    spend: number;
    waterKl: number;
    waterSpend: number;
  }>
) {
  const included = intervals.filter((interval) =>
    activities.some((activity) =>
      activityIncludesInterval(activity.startsAt, activity.endsAt, interval.periodDate, interval.periodTime)
    )
  );
  const slots = new Set<string>();
  for (const activity of activities) {
    const start = localTimestampValue(activity.startsAt);
    const end = localTimestampValue(activity.endsAt);
    for (let slot = start; slot < end; slot += 30 * 60_000) slots.add(String(slot));
  }
  return {
    taggedDurationMinutes: slots.size * 30,
    electricityKwh: included.reduce((sum, row) => sum + row.kwh, 0),
    electricitySpend: included.reduce((sum, row) => sum + row.spend, 0),
    waterKl: included.reduce((sum, row) => sum + row.waterKl, 0),
    waterSpend: included.reduce((sum, row) => sum + row.waterSpend, 0)
  };
}

export function activityMetricValue(
  row: ActivityReportRow,
  metric: keyof Pick<ActivityReportRow, "electricityKwh" | "averageKw" | "electricitySpend" | "waterKl" | "waterSpend">
) {
  return row[metric];
}
