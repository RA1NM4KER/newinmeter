import "server-only";

import { adminSupabaseFetch, adminSupabaseRequest } from "../supabase-rest";
import type { HealthState } from "./health";

export type SystemEventSeverity = "info" | "warning" | "critical";
export type SystemEventCategory = "sync" | "livemopay" | "scheduler" | "push" | "alerts" | "system";

export type SystemEvent = {
  id: string;
  createdAt: string;
  severity: SystemEventSeverity;
  category: SystemEventCategory;
  eventType: string;
  connectionId: string | null;
  message: string;
  metadata: Record<string, unknown>;
  incidentKey: string | null;
  resolvedAt: string | null;
};

type SystemEventRow = {
  id: string;
  created_at: string;
  severity: SystemEventSeverity;
  category: SystemEventCategory;
  event_type: string;
  connection_id: string | null;
  message: string;
  metadata: Record<string, unknown>;
  incident_key: string | null;
  resolved_at: string | null;
};

export type SystemHealthState = {
  component: string;
  status: HealthState;
  lastCheckedAt: string;
  lastSuccessAt: string | null;
  details: Record<string, unknown>;
};

type SystemHealthStateRow = {
  component: string;
  status: HealthState;
  last_checked_at: string;
  last_success_at: string | null;
  details: Record<string, unknown>;
};

const EVENT_SELECT =
  "id,created_at,severity,category,event_type,connection_id,message,metadata,incident_key,resolved_at";
const HEALTH_SELECT = "component,status,last_checked_at,last_success_at,details";

const SENSITIVE_KEY_RE =
  /(password|secret|token|authorization|cipher|auth_tag|\biv\b|account.?id|property.?id|device.?id|company.?id|email|endpoint|p256dh)/i;

export function sanitizeDiagnosticMessage(value: unknown): string {
  const raw = value instanceof Error ? value.message : String(value ?? "Operational check failed.");

  return raw
    .replace(/\bBearer\s+[A-Za-z0-9._~-]+/gi, "Bearer <redacted>")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)?\b/g, "<redacted-token>")
    .replace(/([?&][A-Za-z0-9_-]+)=([^&\s]+)/g, "$1=<redacted>")
    .replace(/(["']?(?:password|refreshToken|idToken|token|secret)["']?\s*[:=]\s*)["']?[^,"'\s}]+/gi, "$1<redacted>")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "<redacted-email>")
    .slice(0, 500);
}

export function sanitizeSystemEventMetadata(metadata: Record<string, unknown> = {}): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(metadata)) {
    if (SENSITIVE_KEY_RE.test(key)) continue;
    if (typeof value === "string") {
      sanitized[key] = sanitizeDiagnosticMessage(value).slice(0, 200);
    } else if (typeof value === "number" || typeof value === "boolean" || value === null) {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

function toEvent(row: SystemEventRow): SystemEvent {
  return {
    id: row.id,
    createdAt: row.created_at,
    severity: row.severity,
    category: row.category,
    eventType: row.event_type,
    connectionId: row.connection_id,
    message: row.message,
    metadata: row.metadata,
    incidentKey: row.incident_key,
    resolvedAt: row.resolved_at
  };
}

function toHealthState(row: SystemHealthStateRow): SystemHealthState {
  return {
    component: row.component,
    status: row.status,
    lastCheckedAt: row.last_checked_at,
    lastSuccessAt: row.last_success_at,
    details: row.details
  };
}

export async function listRecentSystemEvents(limit = 40): Promise<SystemEvent[]> {
  const rows = await adminSupabaseFetch<SystemEventRow[]>(
    `/system_events?select=${EVENT_SELECT}&order=created_at.desc&limit=${Math.max(1, Math.min(limit, 100))}`
  );
  return rows.map(toEvent);
}

export async function listUnresolvedSystemEvents(): Promise<SystemEvent[]> {
  const rows = await adminSupabaseFetch<SystemEventRow[]>(
    `/system_events?select=${EVENT_SELECT}&resolved_at=is.null&order=created_at.desc`
  );
  return rows.map(toEvent);
}

export async function recordSystemEvent(input: {
  severity: SystemEventSeverity;
  category: SystemEventCategory;
  eventType: string;
  connectionId?: string | null;
  message: string;
  metadata?: Record<string, unknown>;
  incidentKey?: string | null;
  resolvedAt?: string | null;
}): Promise<SystemEvent> {
  const rows = await adminSupabaseRequest<SystemEventRow[]>(
    "POST",
    "/system_events",
    {
      severity: input.severity,
      category: input.category,
      event_type: input.eventType,
      connection_id: input.connectionId ?? null,
      message: sanitizeDiagnosticMessage(input.message),
      metadata: sanitizeSystemEventMetadata(input.metadata),
      incident_key: input.incidentKey ?? null,
      resolved_at: input.resolvedAt ?? null
    },
    "return=representation"
  );
  return toEvent(rows[0]);
}

export async function openSystemIncident(input: {
  severity: "warning" | "critical";
  category: SystemEventCategory;
  eventType: string;
  connectionId?: string | null;
  message: string;
  metadata?: Record<string, unknown>;
  incidentKey: string;
}): Promise<{ created: boolean; escalated: boolean; event: SystemEvent }> {
  const existing = await adminSupabaseFetch<SystemEventRow[]>(
    `/system_events?select=${EVENT_SELECT}&incident_key=eq.${encodeURIComponent(input.incidentKey)}` +
      "&resolved_at=is.null&limit=1"
  );
  if (existing[0]) {
    if (existing[0].severity === "warning" && input.severity === "critical") {
      const rows = await adminSupabaseRequest<SystemEventRow[]>(
        "PATCH",
        `/system_events?id=eq.${encodeURIComponent(existing[0].id)}`,
        {
          severity: "critical",
          category: input.category,
          event_type: input.eventType,
          connection_id: input.connectionId ?? existing[0].connection_id,
          message: sanitizeDiagnosticMessage(input.message),
          metadata: sanitizeSystemEventMetadata(input.metadata)
        },
        "return=representation"
      );
      return { created: false, escalated: true, event: toEvent(rows[0]) };
    }
    return { created: false, escalated: false, event: toEvent(existing[0]) };
  }

  try {
    const event = await recordSystemEvent({ ...input, incidentKey: input.incidentKey });
    return { created: true, escalated: false, event };
  } catch (error) {
    // The partial unique index is the race-safe final dedupe. If another
    // worker inserted between our read and write, return its row.
    if (error instanceof Error && (error.message.includes("23505") || error.message.includes("duplicate key"))) {
      const raced = await adminSupabaseFetch<SystemEventRow[]>(
        `/system_events?select=${EVENT_SELECT}&incident_key=eq.${encodeURIComponent(input.incidentKey)}` +
          "&resolved_at=is.null&limit=1"
      );
      if (raced[0]) return { created: false, escalated: false, event: toEvent(raced[0]) };
    }
    throw error;
  }
}

export async function resolveSystemIncident(
  incidentKey: string,
  recovery?: { category: SystemEventCategory; eventType: string; message: string; connectionId?: string | null }
): Promise<boolean> {
  const existing = await adminSupabaseFetch<SystemEventRow[]>(
    `/system_events?select=${EVENT_SELECT}&incident_key=eq.${encodeURIComponent(incidentKey)}` +
      "&resolved_at=is.null&limit=1"
  );
  if (!existing[0]) return false;

  const nowIso = new Date().toISOString();
  await adminSupabaseRequest(
    "PATCH",
    `/system_events?id=eq.${encodeURIComponent(existing[0].id)}`,
    { resolved_at: nowIso },
    "return=minimal"
  );

  if (recovery) {
    await recordSystemEvent({
      severity: "info",
      category: recovery.category,
      eventType: recovery.eventType,
      connectionId: recovery.connectionId ?? existing[0].connection_id,
      message: recovery.message,
      resolvedAt: nowIso
    });
  }
  return true;
}

export async function getSystemHealthStates(): Promise<SystemHealthState[]> {
  const rows = await adminSupabaseFetch<SystemHealthStateRow[]>(`/system_health_state?select=${HEALTH_SELECT}`);
  return rows.map(toHealthState);
}

export async function getSystemHealthState(component: string): Promise<SystemHealthState | null> {
  const rows = await adminSupabaseFetch<SystemHealthStateRow[]>(
    `/system_health_state?select=${HEALTH_SELECT}&component=eq.${encodeURIComponent(component)}&limit=1`
  );
  return rows[0] ? toHealthState(rows[0]) : null;
}

export async function recordSystemHealthCheck(input: {
  component: string;
  status: HealthState;
  succeeded: boolean;
  details?: Record<string, unknown>;
  checkedAt?: Date;
}): Promise<void> {
  const checkedAt = input.checkedAt ?? new Date();
  const checkedIso = checkedAt.toISOString();
  const existing = input.succeeded ? null : await getSystemHealthState(input.component);

  await adminSupabaseRequest(
    "POST",
    "/system_health_state?on_conflict=component",
    {
      component: input.component,
      status: input.status,
      last_checked_at: checkedIso,
      last_success_at: input.succeeded ? checkedIso : (existing?.lastSuccessAt ?? null),
      details: sanitizeSystemEventMetadata(input.details),
      updated_at: checkedIso
    },
    "resolution=merge-duplicates,return=minimal"
  );
}
