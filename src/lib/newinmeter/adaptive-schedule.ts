import "server-only";

import { z } from "zod";
import { computeNextAutoSyncAt } from "./schedule";
import type { NewinmeterCsvRow } from "./web";

const MINUTE = 60_000;
const sampleSchema = z.object({ at: z.string().datetime(), count: z.number().int().min(1).max(100000) });
const streamSchema = z.object({
  samples: z.array(sampleSchema).max(12),
  emptyStreak: z.number().int().min(0).max(20).default(0),
  cadenceMinutes: z.union([z.literal(71), z.literal(106), z.literal(360)]).nullable(),
  confidence: z.number().min(0).max(1)
});
export const reportingModelSchema = z.object({
  version: z.literal(1),
  energy: streamSchema,
  water: streamSchema,
  emptyStreak: z.number().int().min(0).max(20),
  predictedAt: z.string().datetime().nullable(),
  reason: z.string().max(200),
  latestPublicationAt: z.string().datetime().nullable()
});
export type ReportingModel = z.infer<typeof reportingModelSchema>;
type Stream = ReportingModel["energy"];

export function parseReportingModel(value: unknown): ReportingModel {
  const result = reportingModelSchema.safeParse(value);
  return result.success
    ? result.data
    : {
        version: 1,
        energy: { samples: [], cadenceMinutes: null, confidence: 0, emptyStreak: 0 },
        water: { samples: [], cadenceMinutes: null, confidence: 0, emptyStreak: 0 },
        emptyStreak: 0,
        predictedAt: null,
        reason: "Learning publication timing",
        latestPublicationAt: null
      };
}

function observeStream(previous: Stream, rows: NewinmeterCsvRow[], now: Date): Stream {
  const batches = new Map<string, number>();
  for (const row of rows) {
    const timestamp = Date.parse(row.source_ts);
    // Historical imports sometimes substitute the interval time for posting time.
    // Only real, recent publication clusters should affect the current model.
    if (
      !Number.isFinite(timestamp) ||
      timestamp > now.getTime() + 5 * MINUTE ||
      timestamp < now.getTime() - 7 * 1440 * MINUTE
    )
      continue;
    const at = new Date(Math.floor(timestamp / MINUTE) * MINUTE).toISOString();
    batches.set(at, (batches.get(at) ?? 0) + 1);
  }
  for (const sample of previous.samples) {
    if (Date.parse(sample.at) >= now.getTime() - 7 * 1440 * MINUTE)
      batches.set(sample.at, Math.max(sample.count, batches.get(sample.at) ?? 0));
  }
  const samples = Array.from(batches)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-12)
    .map(([at, count]) => ({ at, count }));
  const gaps = samples
    .slice(1)
    .map((sample, index) => (Date.parse(sample.at) - Date.parse(samples[index].at)) / MINUTE);
  const recent = gaps.slice(-6);
  let cadenceMinutes: Stream["cadenceMinutes"] = null;
  let confidence = 0;
  // Three agreeing observations prevent one catch-up batch from upgrading an
  // account. Support is measured over the latest gaps so a new regime replaces
  // an older one, including a return to six-hour batching.
  for (const candidate of [71, 106] as const) {
    const support = recent.filter((gap) => Math.abs(gap - candidate) <= 3).length;
    if (support >= 3 && support / recent.length >= 0.5 && support / recent.length > confidence) {
      cadenceMinutes = candidate;
      confidence = support / recent.length;
    }
  }
  if (
    cadenceMinutes === null &&
    samples.slice(-4).filter((sample) => sample.count >= 10 && sample.count <= 24).length >= 3
  ) {
    cadenceMinutes = 360;
    confidence = 0.75;
  }
  const advanced = samples.at(-1)?.at !== previous.samples.at(-1)?.at;
  return { samples, cadenceMinutes, confidence, emptyStreak: advanced ? 0 : Math.min(20, previous.emptyStreak + 1) };
}

export function observeReporting(
  value: unknown,
  rows: NewinmeterCsvRow[],
  connectionId: string,
  now = new Date()
): ReportingModel {
  const previous = parseReportingModel(value);
  const energy = observeStream(
    previous.energy,
    rows.filter((row) => row.charge_label.startsWith("Energy Charge:")),
    now
  );
  const water = observeStream(
    previous.water,
    rows.filter((row) => row.charge_label.startsWith("Water:")),
    now
  );
  const publications = [...energy.samples, ...water.samples].map((sample) => sample.at).sort();
  const latestPublicationAt = publications.at(-1) ?? previous.latestPublicationAt;
  const advanced = latestPublicationAt !== previous.latestPublicationAt;
  const emptyStreak = advanced ? 0 : Math.min(20, previous.emptyStreak + 1);
  const candidates: number[] = [];
  for (const stream of [energy]) {
    const anchor = stream.samples.at(-1);
    if (
      anchor &&
      stream.cadenceMinutes &&
      stream.cadenceMinutes < 360 &&
      now.getTime() - Date.parse(anchor.at) < 24 * 60 * MINUTE
    ) {
      const expected = Date.parse(anchor.at) + (stream.cadenceMinutes + 10) * MINUTE;
      // A missed prediction gets bounded exponential backoff. Do not advance
      // the anchor through imaginary publications and repeatedly poll emptiness.
      candidates.push(
        expected > now.getTime()
          ? expected
          : now.getTime() + Math.min(360, 30 * 2 ** Math.min(stream.emptyStreak, 4)) * MINUTE
      );
    }
  }
  const fallback = computeNextAutoSyncAt(connectionId, now).getTime();
  const prediction = candidates.length ? Math.min(...candidates) : fallback;
  // Electricity alone drives polling; water observations are diagnostic only.
  // Preserve the one-hour minimum between ordinary adaptive fetches.
  const predictedAt = new Date(
    candidates.length
      ? Math.max(now.getTime() + 60 * MINUTE, Math.min(prediction, now.getTime() + 6 * 60 * MINUTE))
      : fallback
  ).toISOString();
  return {
    version: 1,
    energy,
    water,
    emptyStreak,
    predictedAt,
    latestPublicationAt,
    reason: candidates.length
      ? `Electricity publication prediction: ${energy.cadenceMinutes} min`
      : "Four-window fallback: insufficient recent electricity cadence evidence"
  };
}

export function reconciliationStartDate(lastReconciledAt: string | null, now = new Date()): string | null {
  if (
    lastReconciledAt &&
    Number.isFinite(Date.parse(lastReconciledAt)) &&
    now.getTime() - Date.parse(lastReconciledAt) < 24 * 60 * MINUTE
  )
    return null;
  // Re-read 90 days once daily because newly posted ledger entries may describe
  // old periods. A period-only cursor missed an observed multi-month backlog.
  return new Date(now.getTime() - 90 * 1440 * MINUTE).toISOString().slice(0, 10);
}
