import { describe, expect, it, vi } from "vitest";
import { buildTestContext } from "@/lib/assistant/test-fixtures";
import type { EnergyRow } from "@/lib/types";
import { getRecentTopupsTool } from "./get-recent-topups";

const { loadExportRowsMock } = vi.hoisted(() => ({
  loadExportRowsMock: vi.fn<(...args: unknown[]) => Promise<EnergyRow[]>>()
}));

vi.mock("@/lib/energy-data", () => ({
  loadExportRows: loadExportRowsMock
}));

function topupRow(overrides: Partial<EnergyRow>): EnergyRow {
  return {
    chargeKind: "topup",
    captureTimestamp: 0,
    captureDateTime: "2026-07-01 10:00",
    ledgerTimestamp: 0,
    chargeLabel: "Top Up",
    tariffBand: null,
    periodTimestamp: 0,
    periodDateTime: "2026-07-01T10:00",
    periodDate: "2026-07-01",
    periodTime: "10:00",
    hour: 10,
    kwh: 0,
    waterKl: 0,
    usageAmount: 0,
    usageUnit: null,
    tariff: 0,
    cost: 100,
    balance: 500,
    ...overrides
  };
}

const dayMs = 86_400_000;

describe("getRecentTopupsTool", () => {
  it("requests only topup rows, sorted by captured desc, for the active scope", async () => {
    loadExportRowsMock.mockResolvedValueOnce([]);
    const context = buildTestContext([], [], { from: "2026-07-01", to: "2026-07-31" });

    await getRecentTopupsTool.handler({}, async () => context);

    expect(loadExportRowsMock).toHaveBeenCalledWith("test-token", {
      from: "2026-07-01",
      to: "2026-07-31",
      chargeType: "topup",
      sortKey: "captured",
      sortDirection: "desc"
    });
  });

  it("maps rows to a compact topup summary", async () => {
    loadExportRowsMock.mockResolvedValueOnce([topupRow({ cost: 150, balance: 650 })]);
    const context = buildTestContext([]);

    const result = (await getRecentTopupsTool.handler({}, async () => context)) as {
      count: number;
      topups: Array<{ amount: number; balanceAfter: number }>;
    };

    expect(result.count).toBe(1);
    expect(result.topups[0].amount).toBe(150);
    expect(result.topups[0].balanceAfter).toBe(650);
  });

  it("clamps the limit between 1 and 20", async () => {
    const rows = Array.from({ length: 25 }, (_, index) => topupRow({ cost: index }));
    loadExportRowsMock.mockResolvedValueOnce(rows);
    const context = buildTestContext([]);

    const result = (await getRecentTopupsTool.handler({ limit: 999 }, async () => context)) as {
      topups: unknown[];
    };

    expect(result.topups).toHaveLength(20);
  });

  it("defaults to a limit of 10 when no limit is given", async () => {
    const rows = Array.from({ length: 15 }, (_, index) => topupRow({ cost: index }));
    loadExportRowsMock.mockResolvedValueOnce(rows);
    const context = buildTestContext([]);

    const result = (await getRecentTopupsTool.handler({}, async () => context)) as { topups: unknown[] };
    expect(result.topups).toHaveLength(10);
  });

  it("reports the true total count even when the returned list is truncated by limit", async () => {
    const rows = Array.from({ length: 15 }, (_, index) => topupRow({ cost: index }));
    loadExportRowsMock.mockResolvedValueOnce(rows);
    const context = buildTestContext([]);

    const result = (await getRecentTopupsTool.handler({ limit: 3 }, async () => context)) as {
      count: number;
      topups: unknown[];
    };

    expect(result.count).toBe(15);
    expect(result.topups).toHaveLength(3);
  });

  it("returns zeroed aggregates and null timestamps when there are no top-ups", async () => {
    loadExportRowsMock.mockResolvedValueOnce([]);
    const context = buildTestContext([]);

    const result = (await getRecentTopupsTool.handler({}, async () => context)) as {
      count: number;
      totalAmount: number;
      averageAmount: number;
      earliestTopupAt: string | null;
      latestTopupAt: string | null;
      averageDaysBetweenTopups: number | null;
    };

    expect(result.count).toBe(0);
    expect(result.totalAmount).toBe(0);
    expect(result.averageAmount).toBe(0);
    expect(result.earliestTopupAt).toBeNull();
    expect(result.latestTopupAt).toBeNull();
    expect(result.averageDaysBetweenTopups).toBeNull();
  });

  it("returns null averageDaysBetweenTopups with exactly one top-up", async () => {
    loadExportRowsMock.mockResolvedValueOnce([
      topupRow({ cost: 200, captureTimestamp: 0, captureDateTime: "2026-07-01 10:00" })
    ]);
    const context = buildTestContext([]);

    const result = (await getRecentTopupsTool.handler({}, async () => context)) as {
      count: number;
      totalAmount: number;
      averageAmount: number;
      earliestTopupAt: string | null;
      latestTopupAt: string | null;
      averageDaysBetweenTopups: number | null;
    };

    expect(result.count).toBe(1);
    expect(result.totalAmount).toBe(200);
    expect(result.averageAmount).toBe(200);
    expect(result.earliestTopupAt).toBe("2026-07-01 10:00");
    expect(result.latestTopupAt).toBe("2026-07-01 10:00");
    expect(result.averageDaysBetweenTopups).toBeNull();
  });

  it("computes totalAmount, averageAmount, and averageDaysBetweenTopups across all matched rows, not just the displayed slice", async () => {
    loadExportRowsMock.mockResolvedValueOnce([
      // Returned already sorted captured desc, matching real query order.
      topupRow({ cost: 300, captureTimestamp: 20 * dayMs, captureDateTime: "2026-07-21 09:00" }),
      topupRow({ cost: 100, captureTimestamp: 10 * dayMs, captureDateTime: "2026-07-11 09:00" }),
      topupRow({ cost: 200, captureTimestamp: 0, captureDateTime: "2026-07-01 09:00" })
    ]);
    const context = buildTestContext([]);

    const result = (await getRecentTopupsTool.handler({ limit: 1 }, async () => context)) as {
      count: number;
      totalAmount: number;
      averageAmount: number;
      earliestTopupAt: string | null;
      latestTopupAt: string | null;
      averageDaysBetweenTopups: number | null;
      topups: unknown[];
    };

    expect(result.topups).toHaveLength(1); // display limit still respected
    expect(result.count).toBe(3); // aggregates use the full matched set
    expect(result.totalAmount).toBe(600);
    expect(result.averageAmount).toBe(200);
    expect(result.earliestTopupAt).toBe("2026-07-01 09:00");
    expect(result.latestTopupAt).toBe("2026-07-21 09:00");
    // Span is 20 days across 2 intervals -> 10 days average.
    expect(result.averageDaysBetweenTopups).toBe(10);
  });
});
