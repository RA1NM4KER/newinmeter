"use client";

import { buildActivitySearchParams } from "./query-params";
import { apiEndpoints, buildActivitiesUrl, buildActivityReportUrl } from "../endpoints";
import type { ActivityInput } from "./utils";
import type { ActivityMetric, ActivityReportRow, ActivityReportSummary, UsageActivity } from "../types";

async function responseJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(body?.message || "The request failed.");
    Object.assign(error, { fieldErrors: body?.errors });
    throw error;
  }
  return body as T;
}

export async function fetchActivities(filters: { from?: string; to?: string; date?: string; tags?: string[] } = {}) {
  const params = buildActivitySearchParams(filters);
  return responseJson<{ activities: UsageActivity[] }>(await fetch(buildActivitiesUrl(params), { cache: "no-store" }));
}

export async function fetchActivityTags() {
  return responseJson<{ tags: string[]; colors: Record<string, string> }>(
    await fetch(`${apiEndpoints.activities}?mode=tags`, { cache: "no-store" })
  );
}

export async function fetchActivityReport(filters: {
  from: string;
  to: string;
  tags?: string[];
  metric?: ActivityMetric;
  utility?: string;
}) {
  const params = buildActivitySearchParams(filters);
  return responseJson<{ rows: ActivityReportRow[]; summary: ActivityReportSummary }>(
    await fetch(buildActivityReportUrl(params), { cache: "no-store" })
  );
}

export async function saveActivity(input: ActivityInput, id?: string) {
  const response = await fetch(id ? `${apiEndpoints.activities}/${encodeURIComponent(id)}` : apiEndpoints.activities, {
    method: id ? "PATCH" : "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  return responseJson<{ activity: UsageActivity }>(response);
}

export async function removeActivity(id: string) {
  return responseJson<{ activity: UsageActivity }>(
    await fetch(`${apiEndpoints.activities}/${encodeURIComponent(id)}`, { method: "DELETE" })
  );
}

export function activityFieldErrors(error: unknown) {
  if (error && typeof error === "object" && "fieldErrors" in error) {
    return (error as { fieldErrors?: Record<string, string> }).fieldErrors;
  }
  return undefined;
}
