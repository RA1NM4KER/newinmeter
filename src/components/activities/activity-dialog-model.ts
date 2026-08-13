import { normalizeActivityTag } from "@/lib/activity-utils";

export const halfHourTimes = Array.from({ length: 48 }, (_, index) => {
  const hour = String(Math.floor(index / 2)).padStart(2, "0");
  const minute = index % 2 ? "30" : "00";
  return `${hour}:${minute}`;
});

export function defaultActivityEndTime(startTime: string) {
  const [hours, minutes] = startTime.split(":").map(Number);
  const endMinutes = hours * 60 + minutes + 2 * 60;
  if (endMinutes >= 24 * 60) return "00:00";
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
