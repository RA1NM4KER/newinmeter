import { normalizeActivityTags } from "./activity-utils";
import type { ActivityMetric } from "./types";

const metrics = new Set<ActivityMetric>(["electricityKwh", "averageKw", "electricitySpend", "waterKl", "waterSpend"]);

export function parseActivityQuery(searchParams: URLSearchParams) {
  const date = searchParams.get("date")?.trim() || undefined;
  const from = searchParams.get("from")?.trim() || date;
  const to = searchParams.get("to")?.trim() || date;
  const tags = normalizeActivityTags([
    ...searchParams.getAll("tag"),
    ...searchParams.getAll("tags").flatMap((value) => value.split(","))
  ]);
  const requestedMetric = searchParams.get("metric") as ActivityMetric | null;
  const utilityValue = searchParams.get("utility");
  const utility: "all" | "electricity" | "water" =
    utilityValue === "electricity" || utilityValue === "water" ? utilityValue : "all";

  return {
    from,
    to,
    date,
    tags,
    metric: requestedMetric && metrics.has(requestedMetric) ? requestedMetric : ("electricityKwh" as const),
    utility
  };
}

export function buildActivitySearchParams(filters: {
  from?: string;
  to?: string;
  date?: string;
  tags?: string[];
  metric?: ActivityMetric;
  utility?: string;
}) {
  const params = new URLSearchParams();
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.date) params.set("date", filters.date);
  for (const tag of normalizeActivityTags(filters.tags ?? [])) params.append("tag", tag);
  if (filters.metric) params.set("metric", filters.metric);
  if (filters.utility && filters.utility !== "all") params.set("utility", filters.utility);
  return params;
}

export function replaceActivityTagParams(searchParams: URLSearchParams, tags: string[]) {
  const next = new URLSearchParams(searchParams.toString());
  next.delete("tag");
  next.delete("tags");
  for (const tag of normalizeActivityTags(tags)) next.append("tag", tag);
  return next;
}
