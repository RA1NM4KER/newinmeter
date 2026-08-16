import { DEFAULT_ACTIVITY_COLOR, normalizeActivityTag, type ActivityInput } from "@/lib/activity-utils";
import type { UsageActivity } from "@/lib/types";

export const halfHourTimes = Array.from({ length: 48 }, (_, index) => {
  const hour = String(Math.floor(index / 2)).padStart(2, "0");
  const minute = index % 2 ? "30" : "00";
  return `${hour}:${minute}`;
});

export function activityEndTimeOptions(startTime: string) {
  const startIndex = halfHourTimes.indexOf(startTime);
  if (startIndex === -1) return [];

  return Array.from({ length: 48 }, (_, index) => {
    const value = halfHourTimes[(startIndex + index + 1) % halfHourTimes.length];
    const isNextDay = value <= startTime;
    return {
      value,
      label: isNextDay ? `${value} next day` : value
    };
  });
}

export function defaultActivityEndTime(startTime: string) {
  const [hours, minutes] = startTime.split(":").map(Number);
  const endMinutes = (hours * 60 + minutes + 2 * 60) % (24 * 60);
  return `${String(Math.floor(endMinutes / 60)).padStart(2, "0")}:${String(endMinutes % 60).padStart(2, "0")}`;
}

export function activityToday(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-ZA", {
    timeZone: "Africa/Johannesburg",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export function activityDialogInitialForm(
  activity?: UsageActivity,
  defaultDate?: string,
  defaultStartTime?: string
): ActivityInput {
  return activity
    ? {
        date: activity.startsAt.slice(0, 10),
        allDay: activity.allDay,
        startTime: activity.startsAt.slice(11, 16),
        endTime: activity.endsAt.slice(11, 16),
        tags: activity.tags,
        color: activity.color,
        note: activity.note ?? ""
      }
    : {
        date: defaultDate ?? activityToday(),
        allDay: false,
        startTime: defaultStartTime ?? "18:00",
        endTime: defaultStartTime ? defaultActivityEndTime(defaultStartTime) : "20:30",
        tags: [],
        color: DEFAULT_ACTIVITY_COLOR,
        note: ""
      };
}

export function activityTagSuggestions(existingTags: string[], selectedTags: string[], query: string) {
  const selected = new Set(selectedTags.map(normalizeActivityTag));
  const normalizedQuery = normalizeActivityTag(query);
  return existingTags
    .map(normalizeActivityTag)
    .filter((tag, index, tags) => tags.indexOf(tag) === index)
    .filter((tag) => !selected.has(tag) && (!normalizedQuery || tag.includes(normalizedQuery)))
    .slice(0, 6);
}

export type AddTagOutcome =
  | { status: "empty" }
  | { status: "duplicate" }
  | { status: "limit" }
  | { status: "added"; tags: string[] };

// Pure decision for what happens when a raw tag value is submitted (via
// Enter, the Add button, or a suggestion chip). Kept separate from the
// dialog's state updates so the classification -- duplicate vs. limit vs.
// genuinely new -- is unit-testable without rendering the component. The
// caller is responsible for clearing the text input on every non-"empty"
// outcome; skipping that is what let a rejected duplicate's leftover text
// concatenate with the next tag typed.
export function resolveAddTag(currentTags: string[], rawValue: string, maxTags: number): AddTagOutcome {
  const tag = normalizeActivityTag(rawValue);
  if (!tag) {
    return { status: "empty" };
  }

  if (currentTags.some((current) => normalizeActivityTag(current) === tag)) {
    return { status: "duplicate" };
  }

  if (currentTags.length >= maxTags) {
    return { status: "limit" };
  }

  return { status: "added", tags: [...currentTags, tag] };
}

export function activityColorAfterAddingTag(
  currentTags: string[],
  nextTags: string[],
  currentColor: string | undefined,
  recentTagColors: Record<string, string>
) {
  if (currentTags.length || !nextTags.length) return currentColor;
  return recentTagColors[normalizeActivityTag(nextTags[0])] ?? currentColor;
}
