import { describe, expect, it } from "vitest";
import {
  buildElectricityObservation,
  electricitySchedule,
  evaluateElectricityAvailability,
  AVAILABILITY_ITEM_LIMIT,
  type ElectricityObservation
} from "./electricity-availability";
import { observeReporting } from "./adaptive-schedule";
import type { NewinmeterCsvRow } from "./web";
const row = (at = "2026-10-17T09:10:00Z", period = "2026-10-17 10:00"): NewinmeterCsvRow => ({
  source_ts: at,
  period_dt: period,
  charge_label: "Energy Charge:",
  capture_dt: "17/10/2026 11:10",
  kwh: "0",
  water_kl: "0",
  cost: "0",
  balance: "100",
  tariff: "2"
});
function observation(at: string, rows: NewinmeterCsvRow[] = [], options: Partial<ElectricityObservation> = {}) {
  return {
    ...buildElectricityObservation({
      rows,
      fetchStartedAt: at,
      fetchFinishedAt: new Date(Date.parse(at) + 10000).toISOString(),
      scopeKey: "0".repeat(32),
      startDate: "2026-10-17",
      trigger: "auto",
      reconciliation: false,
      autoSyncEnabled: true,
      parserComplete: true,
      schedule: electricitySchedule({
        model: null,
        mode: "adaptive",
        dueAt: null,
        trigger: "auto",
        httpFailureStreak: 0
      })
    }),
    ...options
  };
}
function evaluate(...observations: ElectricityObservation[]) {
  return evaluateElectricityAvailability(
    observations.map((o, i) => ({ runId: `run-${i}`, connectionId: "a", observation: o }))
  );
}
describe("passive electricity availability facts", () => {
  it("bounds discovery by the last matching absence request start and first response end, not source time", () => {
    const x = evaluate(observation("2026-10-17T09:00:00Z"), observation("2026-10-17T09:15:00Z", [row()]));
    expect(x.publications[0]).toMatchObject({
      publicationAt: "2026-10-17T09:10:00.000Z",
      lastAbsentRunId: "run-0",
      firstFoundRunId: "run-1",
      notAvailableAfter: "2026-10-17T09:00:00Z",
      firstFoundAt: "2026-10-17T09:15:10.000Z",
      windowMinutes: 15 + 1 / 6,
      sourceToVisibleMinutes: { lower: -10, upper: 5 + 1 / 6 },
      evidence: "matching_scope_response_bounds"
    });
  });
  it("uses the latest absence, while retaining the earliest positive through duplicate records and repeated fetches", () => {
    const x = evaluate(
      observation("2026-10-17T09:00:00Z"),
      observation("2026-10-17T09:12:00Z"),
      observation("2026-10-17T09:15:00Z", [row(), row()]),
      observation("2026-10-17T09:20:00Z", [row()])
    );
    expect(x.publications).toHaveLength(1);
    expect(x.publications[0].lastAbsentRunId).toBe("run-1");
    expect(x.publications[0].firstFoundRunId).toBe("run-2");
    expect(x.publications[0].overlappingBatch).toBe(false);
  });
  it("keeps water-only and electricity-empty responses as observations rather than failures", () => {
    const water = { ...row(), charge_label: "Water:", water_kl: "1" };
    const x = evaluate(observation("2026-10-17T09:00:00Z", [water]), observation("2026-10-17T09:15:00Z", [row()]));
    expect(x.fetches[0]).toMatchObject({
      newPublications: 0,
      waterRows: 1,
      electricityRows: 0,
      negativeEvidenceUsable: true
    });
    expect(x.publications[0].lastAbsentRunId).toBe("run-0");
  });
  it("does not confuse zero consumption with a miss", () => {
    expect(evaluate(observation("2026-10-17T09:15:00Z", [row()])).publications).toHaveLength(1);
  });
  it("retains a recently posted historical backfill separately from ordinary publications", () => {
    const x = evaluate(
      observation("2026-10-17T09:00:00Z"),
      observation("2026-10-17T09:15:00Z", [row(undefined, "2026-07-01 00:00")], { reconciliation: true })
    );
    expect(x.publications[0]).toMatchObject({ historical: true, reconciliation: true, lastAbsentRunId: "run-0" });
    expect(x.publications[0].publicationAt).toBe("2026-10-17T09:10:00.000Z");
  });
  it("never substitutes a consumption period or capture time for an invalid or missing source date", () => {
    const x = observation("2026-10-17T09:15:00Z", [row(""), row("2026-10-17 10:00")]);
    expect(x.invalidSourceRows).toBe(2);
    expect(x.items).toEqual([]);
    expect(evaluate(x, observation("2026-10-17T09:30:00Z", [row()])).publications[0].lastAbsentRunId).toBeNull();
  });
  it("does not assign absence through different scopes, incomplete parsing, or truncated inventories", () => {
    for (const options of [
      { scopeKey: "1".repeat(32) },
      { startDate: "2026-07-19" },
      { parserComplete: false },
      { truncated: true }
    ]) {
      const x = evaluate(
        observation("2026-10-17T09:00:00Z", [], options),
        observation("2026-10-17T09:15:00Z", [row()])
      );
      expect(x.publications[0]).toMatchObject({
        lastAbsentRunId: null,
        windowMinutes: null,
        evidence: "upper_bound_only"
      });
    }
  });
  it("does not infer absence from a response outside its retained 48-hour source inventory", () => {
    const prior = observation("2026-10-17T09:00:00Z", [], { trackedSince: "2026-10-17T09:12:00.000Z" });
    expect(evaluate(prior, observation("2026-10-17T09:15:00Z", [row()])).publications[0].lastAbsentRunId).toBeNull();
  });
  it("does not use overlapping requests as a negative availability bound", () => {
    const prior = observation("2026-10-17T09:00:00Z", [], { fetchFinishedAt: "2026-10-17T09:20:00Z" });
    expect(evaluate(prior, observation("2026-10-17T09:15:00Z", [row()])).publications[0].lastAbsentRunId).toBeNull();
  });
  it("marks overlapping source batches when later responses add members instead of inventing another publication", () => {
    const x = evaluate(
      observation("2026-10-17T09:15:00Z", [row()]),
      observation("2026-10-17T09:30:00Z", [row(), row(undefined, "2026-10-17 09:30")])
    );
    expect(x.publications).toHaveLength(1);
    expect(x.publications[0].overlappingBatch).toBe(true);
    expect(x.publications[0].firstFoundRunId).toBe("run-0");
  });
  it("does not count money-only corrections as new publications and flags source-date corrections on both observations", () => {
    const x = evaluate(
      observation("2026-10-17T09:15:00Z", [row()]),
      observation("2026-10-17T09:30:00Z", [{ ...row(), balance: "99" }]),
      observation("2026-10-17T09:45:00Z", [row("2026-10-17T09:40:00Z")])
    );
    expect(x.publications).toHaveLength(2);
    expect(x.fetches[1].newPublications).toBe(0);
    expect(x.publications.every((p) => p.sourceCorrectionPossible)).toBe(true);
  });
  it("flags ambiguous source variants coexisting in the same response", () => {
    const x = evaluate(observation("2026-10-17T09:45:00Z", [row(), row("2026-10-17T09:40:00Z")]));
    expect(x.publications.every((p) => p.sourceCorrectionPossible)).toBe(true);
  });
  it("marks a publication that disappeared from a comparable response then reappeared", () => {
    const x = evaluate(
      observation("2026-10-17T09:15:00Z", [row()]),
      observation("2026-10-17T09:30:00Z"),
      observation("2026-10-17T09:45:00Z", [row()])
    );
    expect(x.publications[0].reappeared).toBe(true);
  });
  it("does not borrow another connection's absence or discovery", () => {
    const x = evaluateElectricityAvailability([
      { connectionId: "a", runId: "1", observation: observation("2026-10-17T09:00:00Z") },
      { connectionId: "b", runId: "2", observation: observation("2026-10-17T09:15:00Z", [row()]) }
    ]);
    expect(x.publications[0].lastAbsentRunId).toBeNull();
  });
  it("keeps future-dated source facts visible but ineligible, never treating a filtered future record as absent", () => {
    const x = evaluate(observation("2026-10-17T09:00:00Z", [row()]), observation("2026-10-17T09:15:00Z", [row()]));
    expect(x.publications).toHaveLength(1);
    expect(x.publications[0]).toMatchObject({ historical: true, firstFoundRunId: "run-0" });
  });
  it("bounds size, reports truncation, and stores neither descriptions nor financial quantities", () => {
    const rows = Array.from({ length: AVAILABILITY_ITEM_LIMIT + 1 }, (_, i) => ({
      ...row(),
      charge_label: `Energy Charge: ${i}`
    }));
    const o = observation("2026-10-17T09:15:00Z", rows);
    expect(o.truncated).toBe(true);
    expect(o.items).toHaveLength(AVAILABILITY_ITEM_LIMIT);
    const text = JSON.stringify(o);
    expect(text).not.toContain("Energy Charge:");
    expect(text).not.toContain("balance");
    expect(Buffer.byteLength(text)).toBeLessThan(65536);
  });
  it("reports insufficient observations without exact or fabricated availability times", () => {
    expect(evaluate()).toEqual({ publications: [], fetches: [] });
    expect(evaluate(observation("2026-10-17T09:15:00Z", [row()])).publications[0]).toMatchObject({
      evidence: "upper_bound_only",
      notAvailableAfter: null,
      windowMinutes: null,
      sourceToVisibleMinutes: { lower: null }
    });
  });
});
describe("passive schedule context", () => {
  const model = observeReporting(
    null,
    [0, 106, 212, 318].map((m) => row(new Date(Date.parse("2026-10-17T00:00:00Z") + m * 60000).toISOString())),
    "a",
    new Date("2026-10-17T05:20:00Z")
  );
  it("retains forecast, confidence, cadence and the existing buffer without changing the model", () => {
    const copy = JSON.stringify(model);
    const s = electricitySchedule({
      model,
      mode: "adaptive",
      dueAt: model.predictedAt,
      trigger: "auto",
      httpFailureStreak: 0
    });
    expect(s).toMatchObject({
      kind: "adaptive_prediction",
      cadenceMinutes: 106,
      confidence: 1,
      expectedPublicationAt: "2026-10-17T07:04:00.000Z",
      bufferedExpectedAt: "2026-10-17T07:14:00.000Z"
    });
    expect(JSON.stringify(model)).toBe(copy);
  });
  it("accepts the timezone-offset due timestamps returned by PostgREST", () => {
    const s = electricitySchedule({
      model,
      mode: "adaptive",
      dueAt: "2026-10-17T07:14:00+00:00",
      trigger: "auto",
      httpFailureStreak: 0
    });
    expect(s.dueAt).toBe("2026-10-17T07:14:00.000Z");
    expect(observation("2026-10-17T09:15:00Z", [], { schedule: s }).schedule.dueAt).toBe(s.dueAt);
  });
  it("distinguishes manual, HTTP failure, post-prediction retry and fixed fallback", () => {
    const p = {
      model,
      mode: "adaptive" as const,
      dueAt: model.predictedAt,
      trigger: "auto" as const,
      httpFailureStreak: 0
    };
    expect(electricitySchedule({ ...p, trigger: "manual" }).kind).toBe("manual");
    expect(electricitySchedule({ ...p, httpFailureStreak: 1 })).toMatchObject({
      kind: "http_retry",
      kindInferred: true
    });
    expect(electricitySchedule({ ...p, model: null }).kind).toBe("fixed_fallback");
    expect(
      electricitySchedule({
        ...p,
        model: { ...model, energy: { ...model.energy, emptyStreak: 1 } },
        decisionAt: new Date("2026-10-17T07:15:00Z")
      })
    ).toMatchObject({
      kind: "publication_retry",
      kindInferred: false
    });
  });
});
