import { loadExportRows } from "@/lib/energy-data";
import type { EnergyRow } from "@/lib/types";
import type { AssistantTool } from "../types";
import { GetRecentTopupsSchema } from "./schemas";

const dayMs = 86_400_000;

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

// Aggregates are computed over every matched top-up row, not just the
// slice returned in `topups`, so "average top-up amount" etc. stay correct
// even when the caller asks for a short display limit.
function summarizeTopups(rows: EnergyRow[]) {
  const count = rows.length;

  if (count === 0) {
    return {
      count: 0,
      totalAmount: 0,
      averageAmount: 0,
      earliestTopupAt: null,
      latestTopupAt: null,
      averageDaysBetweenTopups: null
    };
  }

  const totalAmount = round2(rows.reduce((sum, row) => sum + row.cost, 0));
  const averageAmount = round2(totalAmount / count);
  const chronological = rows.slice().sort((left, right) => left.captureTimestamp - right.captureTimestamp);
  const earliestTopupAt = chronological[0].captureDateTime;
  const latestTopupAt = chronological[chronological.length - 1].captureDateTime;

  let averageDaysBetweenTopups: number | null = null;
  if (count >= 2) {
    const spanMs = chronological[chronological.length - 1].captureTimestamp - chronological[0].captureTimestamp;
    averageDaysBetweenTopups = Number((spanMs / (count - 1) / dayMs).toFixed(1));
  }

  return { count, totalAmount, averageAmount, earliestTopupAt, latestTopupAt, averageDaysBetweenTopups };
}

export const getRecentTopupsTool: AssistantTool = {
  definition: {
    type: "function",
    name: "get_recent_topups",
    description:
      "List the latest top-up rows captured within the active dashboard date range, plus aggregates (total, average amount, and average days between top-ups) across all matched top-ups.",
    parameters: GetRecentTopupsSchema,
    strict: true
  },
  handler: async (args, getContext) => {
    const context = await getContext();
    const requestedLimit = typeof args.limit === "number" ? args.limit : Number(args.limit ?? 10);
    const limit = Math.min(20, Math.max(1, Number.isFinite(requestedLimit) ? requestedLimit : 10));
    const rows = await loadExportRows(context.accessToken, {
      from: context.scope.from,
      to: context.scope.to,
      chargeType: "topup",
      sortKey: "captured",
      sortDirection: "desc"
    });

    return {
      scope: context.scope,
      ...summarizeTopups(rows),
      topups: rows.slice(0, limit).map((row) => ({
        capturedAt: row.captureDateTime,
        period: row.periodDateTime,
        amount: row.cost,
        balanceAfter: row.balance
      }))
    };
  }
};
