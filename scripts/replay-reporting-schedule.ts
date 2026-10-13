// Offline replay: hypothetical eligible accounts, not a live scheduler or billing estimate.
import { readFileSync } from "node:fs";
import { observeReporting, parseReportingModel, type ReportingModel } from "../src/lib/newinmeter/adaptive-schedule";
import { computeNextAutoSyncAt } from "../src/lib/newinmeter/schedule";
import { z } from "zod";
const begin = Date.parse(process.argv[3]);
const end = Date.parse(process.argv[4]);
if (!process.argv[2] || !Number.isFinite(begin) || !Number.isFinite(end) || begin >= end)
  throw new Error("Usage: replay-reporting-schedule.ts ledger.json startISO endISO");
const ledgerRow = z.object({
  capture_dt: z.string(),
  source_ts: z.string(),
  charge_label: z.string(),
  period_dt: z.string(),
  kwh: z.string(),
  water_kl: z.string(),
  tariff: z.string(),
  cost: z.string(),
  balance: z.string()
});
const data = z
  .array(z.object({ account: z.string(), label: z.string(), rows: z.array(ledgerRow) }))
  .parse(JSON.parse(readFileSync(process.argv[2], "utf8")));
type Metrics = {
  calls: number;
  empty: number;
  meanDelayMinutes: number;
  p95DelayMinutes: number;
  energyCadence: number | null;
  waterCadence: number | null;
};
const out = [];
for (const account of data) {
  const observations = account.rows
    .filter((r) => r.charge_label.startsWith("Energy Charge:") || r.charge_label.startsWith("Water:"))
    .map((r) => ({ ...r, at: Date.parse(r.source_ts) }))
    .filter((r) => Number.isFinite(r.at));
  const streams = new Map<number, boolean>();
  for (const r of observations) if (r.at >= begin && r.at < end) streams.set(Math.floor(r.at / 60000) * 60000, true);
  const metrics: { label: string; adaptive?: Metrics; fixed?: Metrics } = { label: account.label };
  for (const adaptive of [false, true]) {
    let t = begin;
    let model: ReportingModel = parseReportingModel({});
    let calls = 0,
      empty = 0;
    const received = new Set<number>();
    const lags: number[] = [];
    let daily: number[] = [];
    while (t < end) {
      daily = daily.filter((x) => x > t - 86400000);
      if (daily.length >= 24) {
        t = daily[0] + 86400000 + 60000;
        continue;
      }
      calls++;
      daily.push(t);
      const rows = observations.filter((r) => r.at <= t && r.at >= t - 7 * 86400000);
      let advanced = false;
      for (const at of Array.from(streams.keys()))
        if (at <= t && !received.has(at)) {
          received.add(at);
          lags.push((t - at) / 60000);
          advanced = true;
        }
      if (!advanced) empty++;
      model = observeReporting(model, rows, account.account, new Date(t));
      const predicted = adaptive
        ? Date.parse(model.predictedAt!)
        : computeNextAutoSyncAt(account.account, new Date(t)).getTime();
      t = Math.ceil(predicted / 300000) * 300000;
    }
    lags.sort((a, b) => a - b);
    metrics[adaptive ? "adaptive" : "fixed"] = {
      calls,
      empty,
      meanDelayMinutes: Math.round(lags.reduce((a, b) => a + b, 0) / (lags.length || 1)),
      p95DelayMinutes: Math.round(lags[Math.floor(lags.length * 0.95)] || 0),
      energyCadence: model.energy.cadenceMinutes,
      waterCadence: model.water.cadenceMinutes
    };
  }
  out.push(metrics);
}
console.log(JSON.stringify(out, null, 2));
