// Read-only exporter. Uses Supabase only; never calls LiveMopay or schedules work.
import { mkdirSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { adminSupabaseFetchAllPages } from "../src/lib/supabase-rest";
import {
  electricityObservationSchema,
  evaluateElectricityAvailability
} from "../src/lib/newinmeter/electricity-availability";
const rowSchema = z.object({
  run_id: z.string().uuid(),
  connection_id: z.string().uuid(),
  observation: electricityObservationSchema,
  capture_runs: z.object({
    status: z.string(),
    started_at: z.string(),
    finished_at: z.string().nullable(),
    rows_fetched: z.number().nullable(),
    rows_changed: z.number().nullable()
  })
});
function distribution(xs: number[]) {
  const sorted = xs.slice().sort((a, b) => a - b);
  return {
    n: xs.length,
    median: sorted.length ? sorted[Math.ceil(sorted.length * 0.5) - 1] : null,
    p90: sorted.length ? sorted[Math.ceil(sorted.length * 0.9) - 1] : null,
    worst: sorted.length ? sorted.at(-1) : null
  };
}
async function main() {
  const [from, to, directory] = process.argv.slice(2);
  z.string().datetime().parse(from);
  z.string().datetime().parse(to);
  if (!directory || Date.parse(to) <= Date.parse(from))
    throw Error("Usage: evaluate-electricity-availability.ts fromISO toISO privateOutputDirectory");
  const rows = (
    await adminSupabaseFetchAllPages<unknown>(
      `/electricity_fetch_observations?select=run_id,connection_id,observation,capture_runs(status,started_at,finished_at,rows_fetched,rows_changed)&observed_at=gte.${encodeURIComponent(from)}&observed_at=lt.${encodeURIComponent(to)}&order=observed_at,run_id`
    )
  ).map((row) => rowSchema.parse(row));
  const aliases = new Map<string, string>(),
    runs = new Map<string, string>(),
    sources = new Map<string, string>();
  for (const r of rows) {
    if (!aliases.has(r.connection_id)) aliases.set(r.connection_id, `Connection ${aliases.size + 1}`);
    if (!runs.has(r.run_id)) runs.set(r.run_id, `Fetch ${runs.size + 1}`);
    if (!sources.has(r.observation.scopeKey)) sources.set(r.observation.scopeKey, `Source ${sources.size + 1}`);
  }
  const captures = rows.map((r) => ({
    runId: runs.get(r.run_id)!,
    connectionId: aliases.get(r.connection_id)!,
    observation: r.observation
  }));
  const result = evaluateElectricityAvailability(captures);
  const eligible = result.publications.filter(
    (p) => !p.historical && !p.sourceCorrectionPossible && !p.overlappingBatch && !p.reappeared
  );
  const bounded = eligible.filter((p) => p.windowMinutes !== null);
  const summary = {
    window: { from, to },
    connections: aliases.size,
    independentScopes: sources.size,
    observations: rows.length,
    firstRetainedPublications: result.publications.length,
    primaryCandidates: eligible.length,
    boundedCandidates: bounded.length,
    upperBoundOnlyCandidates: eligible.length - bounded.length,
    intervalWidthMinutes: distribution(bounded.map((p) => p.windowMinutes!)),
    sourceToVisibilityMinutes: {
      lowerBounds: distribution(bounded.map((p) => p.sourceToVisibleMinutes.lower!)),
      upperBounds: distribution(bounded.map((p) => p.sourceToVisibleMinutes.upper)),
      interpretation:
        "Bounds, not observed visibility delays. Negative lower bounds are retained; a source timestamp is not a proven availability onset."
    },
    noNewRetainedPublication: result.fetches.filter((f) => !f.newPublications).length,
    noNewElectricityWithReturnedWater: result.fetches.filter((f) => !f.newPublications && f.waterRows > 0).length,
    incompleteInventories: rows.filter(
      (r) => !r.observation.parserComplete || r.observation.truncated || r.observation.invalidSourceRows > 0
    ).length,
    retainedFailedIngestions: rows.filter((r) => r.capture_runs.status !== "success").length,
    payloadBytes: rows.reduce((n, r) => n + Buffer.byteLength(JSON.stringify(r.observation)), 0),
    warnings: [
      "First retained presence is not necessarily first-ever upstream publication. Retention and inventory coverage censor observations.",
      "Returned water rows do not prove NEW water; inventory tracks electricity only.",
      "Different request scopes and overlapping/incomplete responses cannot prove absence. Hidden withdrawals are unobservable.",
      "Do not estimate exact visibility times, useful retry waiting or production improvements from interval midpoints.",
      "Do not treat shared-scope connections, ledger rows or overlapping batches as independent trials."
    ]
  };
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const anonymous = rows.map((r, i) => ({
    runId: captures[i].runId,
    connectionId: captures[i].connectionId,
    source: sources.get(r.observation.scopeKey),
    observation: {
      ...r.observation,
      scopeKey: Array.from(sources.keys()).indexOf(r.observation.scopeKey).toString(16).padStart(32, "0")
    },
    capture: r.capture_runs
  }));
  writeFileSync(
    `${directory}/availability.json`,
    JSON.stringify({ summary, ...result, captures: anonymous }, null, 2),
    { mode: 0o600 }
  );
  console.log(JSON.stringify(summary, null, 2));
}
main().catch((error) => {
  console.error(error instanceof Error ? error.name : "Export failed");
  process.exitCode = 1;
});
