import { toEnergyRow, type EnergyRecordInput } from "./csv";
import {
  authenticatedSupabaseFetch,
  authenticatedSupabaseFetchAllPages,
  authenticatedSupabaseResponse
} from "./supabase-rest";
import type { EnergyRow, SyncMetadata } from "./types";
import type { SortDirection, SortKey } from "@/components/data/types";

type SupabaseCaptureRun = {
  started_at: string;
  finished_at: string | null;
  status: string;
  rows_in_csv: number | null;
  rows_synced: number | null;
};
export type ChargeTypeFilter = "all" | EnergyRow["chargeKind"];

export type EnergyRowsPageQuery = {
  from?: string;
  to?: string;
  chargeType?: ChargeTypeFilter;
  search?: string;
  sortKey?: SortKey;
  sortDirection?: SortDirection;
  page?: number;
  pageSize?: number;
};

export type EnergyRowsPage = {
  rows: EnergyRow[];
  total: number;
  page: number;
  pageSize: number;
  sync: SyncMetadata;
  bounds: {
    from: string;
    to: string;
  };
};

const sortColumnByKey: Record<SortKey, string> = {
  period: "period_ts",
  type: "charge_label",
  band: "charge_label",
  kwh: "usage_qty",
  tariff: "tariff",
  amount: "cost",
  balance: "balance",
  captured: "capture_ts"
};

export function contentRangeTotal(contentRange: string | null) {
  if (!contentRange) {
    return 0;
  }

  const totalPart = contentRange.split("/")[1];
  const parsed = Number(totalPart);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function searchFilterOrClause(value: string) {
  const escaped = value.replace(/\*/g, "").trim();

  if (!escaped) {
    return "";
  }

  return `charge_label.ilike.*${escaped}*,period_dt.ilike.*${escaped}*,capture_dt.ilike.*${escaped}*`;
}

export function orderClauseForQuery(sortKey?: SortKey, sortDirection?: SortDirection) {
  const resolvedSortKey = sortKey ?? "captured";
  const mappedSortColumn = sortColumnByKey[resolvedSortKey];
  const mappedSortDirection = sortDirection === "asc" ? "asc" : "desc";

  if (resolvedSortKey === "captured") {
    return `source_ts.${mappedSortDirection}.nullslast,${mappedSortColumn}.${mappedSortDirection},period_ts.${mappedSortDirection}`;
  }

  if (resolvedSortKey === "period") {
    return `${mappedSortColumn}.${mappedSortDirection},source_ts.desc.nullslast,capture_ts.desc`;
  }

  return `${mappedSortColumn}.${mappedSortDirection},source_ts.desc.nullslast,capture_ts.desc,period_ts.desc`;
}

export function queryPathForPage({ from, to, chargeType, search, sortKey, sortDirection }: EnergyRowsPageQuery) {
  const params = new URLSearchParams();
  params.set("select", "capture_dt,charge_label,period_dt,kwh,water_kl,tariff,cost,balance");
  params.set("order", orderClauseForQuery(sortKey, sortDirection));

  if (from) {
    params.append("period_dt", `gte.${from} 00:00:00`);
  }

  if (to) {
    params.append("period_dt", `lte.${to} 23:59:59`);
  }

  if (chargeType === "energy") {
    params.set("charge_label", "like.Energy Charge:*");
  } else if (chargeType === "water") {
    params.set("charge_label", "like.Water:*");
  } else if (chargeType === "topup") {
    params.set("charge_label", "eq.Top Up");
  } else if (chargeType === "refund") {
    params.set("charge_label", "ilike.*refund*");
  } else if (chargeType === "fixed") {
    params.append("charge_label", "not.like.Energy Charge:*");
    params.append("charge_label", "not.like.Water:*");
    params.append("charge_label", "neq.Top Up");
    params.append("charge_label", "not.ilike.*refund*");
  }

  const searchClause = searchFilterOrClause(search ?? "");

  if (searchClause) {
    params.set("or", `(${searchClause})`);
  }

  return `/energy_rows?${params.toString()}`;
}

async function loadEnergyDateBounds(accessToken: string) {
  const [earliest, latest] = await Promise.all([
    authenticatedSupabaseFetch<Array<{ period_dt: string }>>(
      "/energy_rows?select=period_dt&order=period_dt.asc&limit=1",
      accessToken
    ),
    authenticatedSupabaseFetch<Array<{ period_dt: string }>>(
      "/energy_rows?select=period_dt&order=period_dt.desc&limit=1",
      accessToken
    )
  ]);

  const from = earliest[0]?.period_dt?.slice(0, 10) ?? "";
  const to = latest[0]?.period_dt?.slice(0, 10) ?? "";

  return { from, to };
}

export async function loadEnergyRowsPage(accessToken: string, query: EnergyRowsPageQuery): Promise<EnergyRowsPage> {
  const pageSize = Math.min(100, Math.max(25, query.pageSize ?? 50));
  const page = Math.max(1, query.page ?? 1);
  const offset = (page - 1) * pageSize;
  const path = queryPathForPage(query);

  const [response, bounds, sync] = await Promise.all([
    authenticatedSupabaseResponse(path, accessToken, {
      headers: {
        // count=exact forces a real COUNT(*) over the whole filtered set on
        // every page request/keystroke -- with accounts now holding tens of
        // thousands of rows, that alone was enough to hit statement_timeout.
        // count=planned uses the query planner's estimate instead: cheap,
        // and accurate enough for pagination totals.
        Prefer: "count=planned",
        Range: `${offset}-${offset + pageSize - 1}`
      }
    }),
    loadEnergyDateBounds(accessToken),
    loadSyncMetadata(accessToken)
  ]);

  const pageRows = (await response.json()) as EnergyRecordInput[];
  return {
    rows: pageRows.map(toEnergyRow),
    total: contentRangeTotal(response.headers.get("content-range")),
    page,
    pageSize,
    sync,
    bounds
  };
}

async function loadSyncMetadata(accessToken: string): Promise<SyncMetadata> {
  const runs = await authenticatedSupabaseFetch<SupabaseCaptureRun[]>(
    "/capture_runs?select=started_at,finished_at,status,rows_in_csv,rows_synced&status=eq.success&order=finished_at.desc&limit=1",
    accessToken
  );
  const latest = runs[0];

  return {
    lastSyncedAt: latest?.finished_at ?? undefined,
    rowsInCsv: latest?.rows_in_csv ?? undefined,
    rowsSynced: latest?.rows_synced ?? undefined
  };
}

export type CaptureRunStatus = "running" | "success" | "failed";

export type LatestCaptureRun = {
  status: CaptureRunStatus;
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
};

type LatestCaptureRunRow = {
  status: CaptureRunStatus;
  started_at: string;
  finished_at: string | null;
  error: string | null;
};

// Unlike loadSyncMetadata (which only looks at successful runs, for the
// dashboard's "last synced" display), this returns the most recent attempt
// regardless of outcome so a currently-running or failed sync is visible.
export async function loadLatestCaptureRun(accessToken: string): Promise<LatestCaptureRun | null> {
  const runs = await authenticatedSupabaseFetch<LatestCaptureRunRow[]>(
    "/capture_runs?select=status,started_at,finished_at,error&order=started_at.desc&limit=1",
    accessToken
  );
  const latest = runs[0];

  if (!latest) {
    return null;
  }

  return {
    status: latest.status,
    startedAt: latest.started_at,
    finishedAt: latest.finished_at,
    error: latest.error
  };
}

export async function loadExportRows(
  accessToken: string,
  query: Omit<EnergyRowsPageQuery, "page" | "pageSize">
): Promise<EnergyRow[]> {
  const basePath = queryPathForPage(query);
  const rows = await authenticatedSupabaseFetchAllPages<EnergyRecordInput>(basePath, accessToken);

  return rows.map(toEnergyRow);
}
