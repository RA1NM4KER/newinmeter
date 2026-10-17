import "server-only";

import { createHash } from "node:crypto";
import { z } from "zod";
import { parseReportingModel } from "./adaptive-schedule";
import type { NewinmeterCsvRow } from "./web";

const HOUR = 60 * 60_000;
export const AVAILABILITY_ITEM_LIMIT = 256;
const scheduleSchema = z.object({
  policyVersion: z.literal("adaptive-v1"),
  publicationBufferMinutes: z.literal(10),
  mode: z.enum(["shadow", "adaptive"]),
  dueAt: z.string().datetime().nullable(),
  modelTargetAt: z.string().datetime().nullable(),
  anchorAt: z.string().datetime().nullable(),
  expectedPublicationAt: z.string().datetime().nullable(),
  bufferedExpectedAt: z.string().datetime().nullable(),
  cadenceMinutes: z.number().nullable(),
  confidence: z.number(),
  emptyStreak: z.number(),
  httpFailureStreak: z.number(),
  kind: z.enum(["manual", "adaptive_prediction", "publication_retry", "fixed_fallback", "http_retry"]),
  kindInferred: z.boolean()
});
export const electricityObservationSchema = z.object({
  version: z.literal(1),
  fetchStartedAt: z.string().datetime(),
  fetchFinishedAt: z.string().datetime(),
  scopeKey: z.string().regex(/^[0-9a-f]{32}$/),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  trackedSince: z.string().datetime(),
  trigger: z.enum(["auto", "manual"]),
  reconciliation: z.boolean(),
  autoSyncEnabled: z.boolean(),
  parserComplete: z.boolean(),
  truncated: z.boolean(),
  invalidSourceRows: z.number().int().nonnegative(),
  outsideWindowRows: z.number().int().nonnegative(),
  electricityRows: z.number().int().nonnegative(),
  waterRows: z.number().int().nonnegative(),
  schedule: scheduleSchema,
  nextDecision: scheduleSchema.nullable(),
  items: z
    .array(
      z.object({
        publicationAt: z.string().datetime(),
        identity: z.string().regex(/^[0-9a-f]{32}$/),
        historical: z.boolean(),
        future: z.boolean()
      })
    )
    .max(AVAILABILITY_ITEM_LIMIT)
});
export type ElectricityObservation = z.infer<typeof electricityObservationSchema>;
export type AvailabilitySchedule = z.infer<typeof scheduleSchema>;

export function electricitySchedule(params: {
  model: unknown;
  mode: "shadow" | "adaptive";
  dueAt: string | null;
  trigger: "auto" | "manual";
  httpFailureStreak: number;
  decisionAt?: Date;
}): AvailabilitySchedule {
  const m = parseReportingModel(params.model),
    e = m.energy;
  const anchorAt = e.samples.at(-1)?.at ?? null;
  const fast =
    anchorAt !== null &&
    e.cadenceMinutes !== null &&
    e.cadenceMinutes < 360 &&
    m.reason.startsWith("Electricity publication prediction:");
  const expectedPublicationAt =
    anchorAt && e.cadenceMinutes ? new Date(Date.parse(anchorAt) + e.cadenceMinutes * 60_000).toISOString() : null;
  const bufferedExpectedAt =
    fast && expectedPublicationAt ? new Date(Date.parse(expectedPublicationAt) + 10 * 60_000).toISOString() : null;
  const retry =
    e.emptyStreak > 0 &&
    bufferedExpectedAt &&
    (params.decisionAt
      ? Date.parse(bufferedExpectedAt) <= params.decisionAt.getTime()
      : e.emptyStreak > 0 && Date.parse(m.predictedAt ?? "") > Date.parse(bufferedExpectedAt));
  return {
    policyVersion: "adaptive-v1",
    publicationBufferMinutes: 10,
    mode: params.mode,
    dueAt: params.dueAt,
    modelTargetAt: m.predictedAt,
    anchorAt,
    expectedPublicationAt,
    bufferedExpectedAt,
    cadenceMinutes: e.cadenceMinutes,
    confidence: e.confidence,
    emptyStreak: e.emptyStreak,
    httpFailureStreak: params.httpFailureStreak,
    kind:
      params.trigger === "manual"
        ? "manual"
        : params.httpFailureStreak > 0
          ? "http_retry"
          : params.mode !== "adaptive" || !fast
            ? "fixed_fallback"
            : retry
              ? "publication_retry"
              : "adaptive_prediction",
    kindInferred: params.trigger === "auto" && params.httpFailureStreak === 0 && !params.decisionAt
  };
}

export function buildElectricityObservation(params: {
  rows: NewinmeterCsvRow[];
  fetchStartedAt: string;
  fetchFinishedAt: string;
  startDate: string;
  scopeKey: string;
  trigger: "auto" | "manual";
  reconciliation: boolean;
  autoSyncEnabled: boolean;
  parserComplete: boolean;
  schedule: AvailabilitySchedule;
}): ElectricityObservation {
  const finished = Date.parse(params.fetchFinishedAt),
    since = Date.parse(params.fetchStartedAt) - 48 * HOUR;
  const items = new Map<string, ElectricityObservation["items"][number]>();
  let electricityRows = 0,
    waterRows = 0,
    invalidSourceRows = 0,
    outsideWindowRows = 0;
  for (const r of params.rows) {
    if (r.charge_label.startsWith("Water:")) waterRows++;
    if (!r.charge_label.startsWith("Energy Charge:")) continue;
    electricityRows++;
    // Only the API's timezone-qualified posting field is evidence of publication.
    // Never substitute capture_dt or the consumption period for missing dates.
    const at = Date.parse(r.source_ts);
    if (!/T.*(?:Z|[+-]\d\d:\d\d)$/i.test(r.source_ts) || !Number.isFinite(at)) {
      invalidSourceRows++;
      continue;
    }
    if (at < since) {
      outsideWindowRows++;
      continue;
    }
    const publicationAt = new Date(at).toISOString();
    // Amount/balance changes are the same observed event. A source-date change
    // retains the period identity and can be flagged as an ambiguous correction.
    const identity = createHash("sha256")
      .update(JSON.stringify([r.charge_label.trim(), r.period_dt.trim()]))
      .digest("hex")
      .slice(0, 32);
    const period = Date.parse(r.period_dt.replace(" ", "T") + ":00+02:00");
    items.set(`${publicationAt}:${identity}`, {
      publicationAt,
      identity,
      historical: !Number.isFinite(period) || at - period > 48 * HOUR || period > at,
      future: at > finished
    });
  }
  const all = Array.from(items.values()).sort(
    (a, b) => b.publicationAt.localeCompare(a.publicationAt) || a.identity.localeCompare(b.identity)
  );
  return electricityObservationSchema.parse({
    version: 1,
    fetchStartedAt: params.fetchStartedAt,
    fetchFinishedAt: params.fetchFinishedAt,
    startDate: params.startDate,
    scopeKey: params.scopeKey,
    trackedSince: new Date(since).toISOString(),
    trigger: params.trigger,
    reconciliation: params.reconciliation,
    autoSyncEnabled: params.autoSyncEnabled,
    parserComplete: params.parserComplete,
    truncated: all.length > AVAILABILITY_ITEM_LIMIT,
    invalidSourceRows,
    outsideWindowRows,
    electricityRows,
    waterRows,
    schedule: params.schedule,
    nextDecision: null,
    items: all.slice(0, AVAILABILITY_ITEM_LIMIT)
  });
}

export type AvailabilityCapture = { runId: string; connectionId: string; observation: ElectricityObservation };

// Offline analysis only. Missing captures, parse failures and different query
// scopes cannot be converted into negative evidence. Bounds use request START
// for absence and response END for presence because server snapshot time is unknown.
export function evaluateElectricityAvailability(captures: AvailabilityCapture[]) {
  const byConnection = new Map<string, AvailabilityCapture[]>();
  for (const c of captures) {
    const key = `${c.connectionId}:${c.observation.scopeKey}`;
    const list = byConnection.get(key) ?? [];
    list.push(c);
    byConnection.set(key, list);
  }
  const publications: Array<{
    connectionId: string;
    publicationAt: string;
    firstFoundRunId: string;
    firstFoundAt: string;
    lastAbsentRunId: string | null;
    notAvailableAfter: string | null;
    windowMinutes: number | null;
    sourceToVisibleMinutes: { lower: number | null; upper: number };
    historical: boolean;
    sourceCorrectionPossible: boolean;
    overlappingBatch: boolean;
    reappeared: boolean;
    schedule: AvailabilitySchedule;
    trigger: "auto" | "manual";
    reconciliation: boolean;
    evidence: "matching_scope_response_bounds" | "upper_bound_only";
  }> = [];
  const fetches: Array<{
    runId: string;
    connectionId: string;
    newPublications: number;
    waterRows: number;
    electricityRows: number;
    negativeEvidenceUsable: boolean;
    schedule: AvailabilitySchedule;
    baseline: boolean;
    reconciliation: boolean;
  }> = [];
  for (const list of Array.from(byConnection.values())) {
    const connectionId = list[0].connectionId;
    list.sort(
      (a, b) =>
        a.observation.fetchFinishedAt.localeCompare(b.observation.fetchFinishedAt) || a.runId.localeCompare(b.runId)
    );
    const seen = new Map<string, (typeof publications)[number]>(),
      identities = new Map<string, Set<string>>();
    const members = new Map<string, Set<string>>();
    for (let i = 0; i < list.length; i++) {
      const c = list[i],
        o = c.observation;
      const priorDecision = list[i - 1]?.observation.nextDecision;
      const schedule =
        priorDecision &&
        o.trigger === "auto" &&
        o.schedule.httpFailureStreak === 0 &&
        priorDecision.modelTargetAt === o.schedule.modelTargetAt &&
        priorDecision.anchorAt === o.schedule.anchorAt
          ? { ...o.schedule, kind: priorDecision.kind, kindInferred: false }
          : o.schedule;
      const groups = new Map<string, typeof o.items>();
      for (const item of o.items) {
        const g = groups.get(item.publicationAt) ?? [];
        g.push(item);
        groups.set(item.publicationAt, g);
      }
      let newPublications = 0;
      for (const [at, items] of Array.from(groups)) {
        const known = seen.get(at),
          previousMembers = members.get(at) ?? new Set<string>();
        const corrected = items.some((item) =>
          Array.from(identities.get(item.identity) ?? []).some((old) => old !== at)
        );
        if (corrected)
          for (const item of items)
            for (const other of Array.from(identities.get(item.identity) ?? [])) {
              const old = seen.get(other);
              if (old && other !== at) old.sourceCorrectionPossible = true;
            }
        if (known) {
          known.overlappingBatch ||= items.some((item) => !previousMembers.has(item.identity));
          known.sourceCorrectionPossible ||= corrected;
          known.historical ||= items.some((item) => item.historical || item.future);
          known.reappeared ||= list
            .slice(0, i)
            .some(
              (prior) =>
                prior.observation.fetchStartedAt > known.firstFoundAt && canConfirmAbsence(prior.observation, o, at)
            );
        } else {
          newPublications++;
          const negative = list
            .slice(0, i)
            .filter(
              (prior) =>
                prior.observation.fetchFinishedAt <= o.fetchStartedAt && canConfirmAbsence(prior.observation, o, at)
            )
            .sort((a, b) => b.observation.fetchStartedAt.localeCompare(a.observation.fetchStartedAt))[0];
          const lower = negative?.observation.fetchStartedAt ?? null;
          const result = {
            connectionId,
            publicationAt: at,
            firstFoundRunId: c.runId,
            firstFoundAt: o.fetchFinishedAt,
            lastAbsentRunId: negative?.runId ?? null,
            notAvailableAfter: lower,
            windowMinutes: lower ? (Date.parse(o.fetchFinishedAt) - Date.parse(lower)) / 60000 : null,
            sourceToVisibleMinutes: {
              lower: lower ? (Date.parse(lower) - Date.parse(at)) / 60000 : null,
              upper: (Date.parse(o.fetchFinishedAt) - Date.parse(at)) / 60000
            },
            historical: items.some((item) => item.historical || item.future),
            sourceCorrectionPossible: corrected,
            overlappingBatch: false,
            reappeared: false,
            schedule,
            trigger: o.trigger,
            reconciliation: o.reconciliation,
            evidence: lower ? ("matching_scope_response_bounds" as const) : ("upper_bound_only" as const)
          };
          seen.set(at, result);
          publications.push(result);
        }
        for (const item of items) {
          previousMembers.add(item.identity);
          const dates = identities.get(item.identity) ?? new Set<string>();
          dates.add(at);
          identities.set(item.identity, dates);
        }
        members.set(at, previousMembers);
      }
      fetches.push({
        runId: c.runId,
        connectionId,
        newPublications,
        waterRows: o.waterRows,
        electricityRows: o.electricityRows,
        schedule,
        baseline: i === 0,
        reconciliation: o.reconciliation,
        negativeEvidenceUsable: o.parserComplete && !o.truncated && o.invalidSourceRows === 0
      });
    }
  }
  return { publications, fetches };
}
function canConfirmAbsence(prior: ElectricityObservation, current: ElectricityObservation, at: string) {
  return (
    prior.scopeKey === current.scopeKey &&
    prior.startDate === current.startDate &&
    prior.parserComplete &&
    !prior.truncated &&
    prior.invalidSourceRows === 0 &&
    at >= prior.trackedSince &&
    at >= current.trackedSince &&
    !prior.items.some((item) => item.publicationAt === at)
  );
}

export function electricityScopeKey(parts: string[]) {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 32);
}
