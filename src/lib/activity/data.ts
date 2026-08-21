import "server-only";

import {
  addDaysToIsoDate,
  buildActivityRange,
  normalizeActivityTags,
  validateActivityInput,
  type ActivityInput
} from "./utils";
import { authenticatedSupabaseFetch, authenticatedSupabaseFetchAllPages } from "../supabase-rest";
import type { ActivityReportRow, ActivityReportSummary, UsageActivity } from "../types";

type ActivityRow = {
  id: string;
  connection_id: string;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  tags: string[];
  color: string;
  note: string | null;
  created_at: string;
  updated_at: string;
};

type ActivityReportDbRow = Omit<ActivityRow, "connection_id"> & {
  duration_minutes: number | string;
  electricity_kwh: number | string;
  average_kw: number | string | null;
  electricity_spend: number | string;
  water_kl: number | string;
  water_spend: number | string;
};

type ActivitySummaryDbRow = {
  activity_count: number | string;
  tagged_duration_minutes: number | string;
  electricity_kwh: number | string;
  average_electricity_kwh_per_activity: number | string | null;
  electricity_spend: number | string;
  water_kl: number | string;
  water_spend: number | string;
};

const activitySelect = "id,connection_id,starts_at,ends_at,all_day,tags,color,note,created_at,updated_at";

function numberValue(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function mapActivityRow(row: ActivityRow): UsageActivity {
  return {
    id: row.id,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    allDay: row.all_day,
    tags: row.tags,
    color: row.color,
    note: row.note ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapReportRow(row: ActivityReportDbRow): ActivityReportRow {
  const activity = mapActivityRow({ ...row, connection_id: "" });
  return {
    ...activity,
    date: activity.startsAt.slice(0, 10),
    durationMinutes: numberValue(row.duration_minutes),
    electricityKwh: numberValue(row.electricity_kwh),
    averageKw: numberValue(row.average_kw),
    electricitySpend: numberValue(row.electricity_spend),
    waterKl: numberValue(row.water_kl),
    waterSpend: numberValue(row.water_spend)
  };
}

export function buildActivitiesPath(filters: { from?: string; to?: string; tags?: string[]; date?: string } = {}) {
  const from = filters.date ?? filters.from;
  const to = filters.date ?? filters.to;
  const params = new URLSearchParams();
  params.set("select", activitySelect);
  if (from) params.set("ends_at", `gt.${from}T00:00:00`);
  if (to) params.set("starts_at", `lt.${addDaysToIsoDate(to, 1)}T00:00:00`);
  const tags = normalizeActivityTags(filters.tags ?? []);
  if (tags.length) params.set("tags", `ov.{${tags.join(",")}}`);
  params.set("order", "starts_at.asc,created_at.asc");
  return `/usage_activities?${params.toString()}`;
}

export async function loadActivities(
  accessToken: string,
  filters: { from?: string; to?: string; tags?: string[]; date?: string } = {}
) {
  const rows = await authenticatedSupabaseFetchAllPages<ActivityRow>(buildActivitiesPath(filters), accessToken);
  return rows.map(mapActivityRow);
}

export function buildActivityTagMetadata(rows: Array<{ tags: string[]; color: string }>) {
  const colors: Record<string, string> = {};
  for (const row of rows) {
    for (const tag of normalizeActivityTags(row.tags)) colors[tag] ??= row.color;
  }
  return { tags: Object.keys(colors).sort(), colors };
}

export async function loadActivityTags(accessToken: string) {
  const rows = await authenticatedSupabaseFetchAllPages<{ tags: string[]; color: string }>(
    "/usage_activities?select=tags,color&order=updated_at.desc",
    accessToken
  );
  return buildActivityTagMetadata(rows);
}

function validatedPayload(input: ActivityInput, connectionId: string) {
  const validation = validateActivityInput(input);
  if (!validation.success) {
    const error = new Error("Invalid activity.");
    Object.assign(error, { validationErrors: validation.errors });
    throw error;
  }
  const range = buildActivityRange(validation.value);
  return {
    connection_id: connectionId,
    starts_at: range.startsAt,
    ends_at: range.endsAt,
    all_day: validation.value.allDay,
    tags: validation.value.tags,
    color: validation.value.color,
    note: validation.value.note ?? null
  };
}

export async function createActivity(accessToken: string, connectionId: string, input: ActivityInput) {
  const rows = await authenticatedSupabaseFetch<ActivityRow[]>("/usage_activities", accessToken, {
    method: "POST",
    headers: { "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify(validatedPayload(input, connectionId))
  });
  return mapActivityRow(rows[0]);
}

function activityToInput(activity: UsageActivity): ActivityInput {
  return {
    date: activity.startsAt.slice(0, 10),
    allDay: activity.allDay,
    startTime: activity.startsAt.slice(11, 16),
    endTime: activity.endsAt.slice(11, 16),
    tags: activity.tags,
    color: activity.color,
    note: activity.note
  };
}

export async function updateActivity(
  accessToken: string,
  connectionId: string,
  id: string,
  updates: Partial<ActivityInput>
) {
  const existingRows = await authenticatedSupabaseFetch<ActivityRow[]>(
    `/usage_activities?select=${activitySelect}&id=eq.${encodeURIComponent(id)}&limit=1`,
    accessToken
  );
  const existing = existingRows[0];
  if (!existing) return null;
  const merged = { ...activityToInput(mapActivityRow(existing)), ...updates };
  const payload = validatedPayload(merged, connectionId);
  const rows = await authenticatedSupabaseFetch<ActivityRow[]>(
    `/usage_activities?id=eq.${encodeURIComponent(id)}`,
    accessToken,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Prefer: "return=representation" },
      body: JSON.stringify(payload)
    }
  );
  return rows[0] ? mapActivityRow(rows[0]) : null;
}

export async function deleteActivity(accessToken: string, id: string) {
  const rows = await authenticatedSupabaseFetch<ActivityRow[]>(
    `/usage_activities?id=eq.${encodeURIComponent(id)}`,
    accessToken,
    { method: "DELETE", headers: { Prefer: "return=representation" } }
  );
  return rows[0] ? mapActivityRow(rows[0]) : null;
}

export async function loadActivityReport(
  accessToken: string,
  filters: { from: string; to: string; tags?: string[]; utility?: "all" | "electricity" | "water" }
) {
  const body = JSON.stringify({
    p_from: filters.from,
    p_to: filters.to,
    p_tags: normalizeActivityTags(filters.tags ?? []),
    p_utility: filters.utility ?? "all"
  });
  const headers = { "Content-Type": "application/json" };
  const [rows, summaries] = await Promise.all([
    authenticatedSupabaseFetchAllPages<ActivityReportDbRow>("/rpc/usage_activity_report", accessToken, {
      method: "POST",
      headers,
      body
    }),
    authenticatedSupabaseFetch<ActivitySummaryDbRow[]>("/rpc/usage_activity_report_summary", accessToken, {
      method: "POST",
      headers,
      body
    })
  ]);
  const summary = summaries[0];
  const mappedSummary: ActivityReportSummary = {
    activityCount: numberValue(summary?.activity_count),
    taggedDurationMinutes: numberValue(summary?.tagged_duration_minutes),
    electricityKwh: numberValue(summary?.electricity_kwh),
    averageElectricityKwhPerActivity: numberValue(summary?.average_electricity_kwh_per_activity),
    electricitySpend: numberValue(summary?.electricity_spend),
    waterKl: numberValue(summary?.water_kl),
    waterSpend: numberValue(summary?.water_spend)
  };
  return { rows: rows.map(mapReportRow), summary: mappedSummary };
}

export function activityValidationErrors(error: unknown) {
  if (error && typeof error === "object" && "validationErrors" in error) {
    return (error as { validationErrors: Record<string, string> }).validationErrors;
  }
  return undefined;
}
