import "server-only";

import type { DashboardSummary, DailyRollupRow, HourlyRollupRow, IntervalRollupRow } from "./types";
import { authenticatedSupabaseFetch, authenticatedSupabaseFetchAllPages } from "./supabase-rest";

function toNumber(value: unknown) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

// No connection_id filter in any of these queries: RLS scopes every read to
// the caller's own connection via the forwarded access token (see
// supabase-rest.ts's authenticatedSupabase* helpers and the
// owns_livemopay_connection() policies), and this MVP has at most one
// connected connection per user, so "my rows" and "all rows visible to me"
// are the same set.
export async function loadDashboardSummary(accessToken: string): Promise<DashboardSummary> {
  const rows = await authenticatedSupabaseFetch<
    Array<{
      date_start: string | null;
      date_end: string | null;
      latest_balance: number | string | null;
      latest_period: string | null;
      last_synced_at: string | null;
      rows_in_csv: number | null;
      rows_synced: number | null;
      max_interval_spend: number | string | null;
      max_interval_kwh: number | string | null;
      max_water_interval_spend: number | string | null;
      max_water_interval_kl: number | string | null;
    }>
  >(
    "/dashboard_summary?select=date_start,date_end,latest_balance,latest_period,last_synced_at,rows_in_csv,rows_synced,max_interval_spend,max_interval_kwh,max_water_interval_spend,max_water_interval_kl&limit=1",
    accessToken
  );

  const row = rows[0];

  return {
    dateStart: row?.date_start ?? undefined,
    dateEnd: row?.date_end ?? undefined,
    latestBalance:
      row?.latest_balance === null || row?.latest_balance === undefined ? undefined : toNumber(row.latest_balance),
    latestPeriod: row?.latest_period ?? undefined,
    lastSyncedAt: row?.last_synced_at ?? undefined,
    rowsInCsv: row?.rows_in_csv ?? undefined,
    rowsSynced: row?.rows_synced ?? undefined,
    maxIntervalSpend:
      row?.max_interval_spend === null || row?.max_interval_spend === undefined
        ? undefined
        : toNumber(row.max_interval_spend),
    maxIntervalKwh:
      row?.max_interval_kwh === null || row?.max_interval_kwh === undefined
        ? undefined
        : toNumber(row.max_interval_kwh),
    maxWaterIntervalSpend:
      row?.max_water_interval_spend === null || row?.max_water_interval_spend === undefined
        ? undefined
        : toNumber(row.max_water_interval_spend),
    maxWaterIntervalKl:
      row?.max_water_interval_kl === null || row?.max_water_interval_kl === undefined
        ? undefined
        : toNumber(row.max_water_interval_kl)
  };
}

export async function loadDashboardDailyRollups(
  accessToken: string,
  range?: { from?: string; to?: string }
): Promise<DailyRollupRow[]> {
  const filters = [
    range?.from ? `period_date=gte.${encodeURIComponent(range.from)}` : undefined,
    range?.to ? `period_date=lte.${encodeURIComponent(range.to)}` : undefined
  ]
    .filter(Boolean)
    .join("&");

  const rows = await authenticatedSupabaseFetchAllPages<{
    period_date: string;
    energy_spend: number | string;
    water_spend: number | string;
    fixed_spend: number | string;
    topup_amount: number | string;
    total_spend: number | string;
    energy_kwh: number | string;
    water_kl: number | string;
    weighted_tariff: number | string;
    peak_tariff: number | string;
    all_in_rate: number | string;
    balance_end: number | string;
    latest_period: string | null;
    energy_intervals: number | string;
    water_intervals: number | string;
    is_complete: boolean;
  }>(
    `/energy_day_rollups?select=period_date,energy_spend,water_spend,fixed_spend,topup_amount,total_spend,energy_kwh,water_kl,weighted_tariff,peak_tariff,all_in_rate,balance_end,latest_period,energy_intervals,water_intervals,is_complete${filters ? `&${filters}` : ""}&order=period_date.asc`,
    accessToken
  );

  return rows.map((row) => ({
    periodDate: row.period_date,
    energySpend: toNumber(row.energy_spend),
    waterSpend: toNumber(row.water_spend),
    fixedSpend: toNumber(row.fixed_spend),
    topupAmount: toNumber(row.topup_amount),
    totalSpend: toNumber(row.total_spend),
    energyKwh: toNumber(row.energy_kwh),
    waterKl: toNumber(row.water_kl),
    weightedTariff: toNumber(row.weighted_tariff),
    peakTariff: toNumber(row.peak_tariff),
    allInRate: toNumber(row.all_in_rate),
    balanceEnd: toNumber(row.balance_end),
    latestPeriod: row.latest_period ?? undefined,
    energyIntervals: toNumber(row.energy_intervals),
    waterIntervals: toNumber(row.water_intervals),
    isComplete: Boolean(row.is_complete)
  }));
}

export async function loadDashboardHourlyRollups(accessToken: string): Promise<HourlyRollupRow[]> {
  const rows = await authenticatedSupabaseFetchAllPages<{
    period_date: string;
    hour: number | string;
    spend: number | string;
    kwh: number | string;
    water_spend: number | string;
    water_kl: number | string;
    intervals: number | string;
    water_intervals: number | string;
  }>(
    "/energy_hourly_rollups?select=period_date,hour,spend,kwh,water_spend,water_kl,intervals,water_intervals&order=period_date.asc,hour.asc",
    accessToken
  );

  return rows.map((row) => ({
    periodDate: row.period_date,
    hour: toNumber(row.hour),
    spend: toNumber(row.spend),
    kwh: toNumber(row.kwh),
    waterSpend: toNumber(row.water_spend),
    waterKl: toNumber(row.water_kl),
    intervals: toNumber(row.intervals),
    waterIntervals: toNumber(row.water_intervals)
  }));
}

export async function loadDayIntervalRollups(accessToken: string, periodDate: string): Promise<IntervalRollupRow[]> {
  const rows = await authenticatedSupabaseFetch<
    Array<{
      period_date: string;
      period_time: string;
      spend: number | string;
      kwh: number | string;
      water_spend: number | string;
      water_kl: number | string;
    }>
  >(
    `/energy_interval_rollups?select=period_date,period_time,spend,kwh,water_spend,water_kl&period_date=eq.${encodeURIComponent(periodDate)}&order=period_time.asc`,
    accessToken
  );

  return rows.map((row) => ({
    periodDate: row.period_date,
    periodTime: row.period_time.slice(0, 5),
    spend: toNumber(row.spend),
    kwh: toNumber(row.kwh),
    waterSpend: toNumber(row.water_spend),
    waterKl: toNumber(row.water_kl)
  }));
}
