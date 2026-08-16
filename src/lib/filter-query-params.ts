import { z } from "zod";

export const filterQueryParamKeys = {
  from: "from",
  to: "to"
} as const;

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

// The regex alone accepts shape-only garbage like "2026-13-99" (not a real
// calendar date), which downstream date pickers and Date parsing choke on.
// Confirm the parts round-trip through Date's own calendar math too.
function isValidCalendarDate(value: string) {
  if (!isoDatePattern.test(value)) {
    return false;
  }

  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

const dateRangeQuerySchema = z.object({
  from: z
    .string()
    .optional()
    .transform((value) => {
      const trimmed = value?.trim() ?? "";
      return isValidCalendarDate(trimmed) ? trimmed : "";
    }),
  to: z
    .string()
    .optional()
    .transform((value) => {
      const trimmed = value?.trim() ?? "";
      return isValidCalendarDate(trimmed) ? trimmed : "";
    })
});

export type DateRangeQueryParams = {
  from: string;
  to: string;
};

export function dateRangeQueryUpdates(from: string, to: string) {
  return {
    [filterQueryParamKeys.from]: from || null,
    [filterQueryParamKeys.to]: to || null
  };
}

export function parseDateRangeQuery(searchParams: URLSearchParams): DateRangeQueryParams {
  const range = dateRangeQuerySchema.parse({
    from: searchParams.get(filterQueryParamKeys.from) ?? undefined,
    to: searchParams.get(filterQueryParamKeys.to) ?? undefined
  });

  return range.from && range.to && range.from > range.to ? { from: "", to: "" } : range;
}
