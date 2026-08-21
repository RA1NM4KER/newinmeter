import { describe, expect, it } from "vitest";
import { buildRefundTopupDeletePath, refundTopupMatchers } from "@/lib/newinmeter/sync";
import type { NewinmeterCsvRow } from "@/lib/newinmeter/web";

function row(overrides: Partial<NewinmeterCsvRow>): NewinmeterCsvRow {
  return {
    capture_dt: "08/08/2026 22:00",
    source_ts: "2026-08-08T20:00:30.0071950Z",
    charge_label: "Incorrect Tariff Refund",
    period_dt: "2026-08-08 22:00",
    kwh: "0",
    water_kl: "0",
    tariff: "0",
    cost: "-273.79",
    balance: "1039.47",
    ...overrides
  };
}

describe("refundTopupMatchers", () => {
  it("fingerprints refund rows with the positive (old-parser) cost", () => {
    const matchers = refundTopupMatchers([row({})]);
    expect(matchers).toEqual([
      {
        sourceTs: "2026-08-08T20:00:30.0071950Z",
        cost: "273.79",
        balance: "1039.47",
        periodDt: "2026-08-08 22:00"
      }
    ]);
  });

  it("ignores non-refund rows (energy charges and genuine top-ups)", () => {
    const matchers = refundTopupMatchers([
      row({ charge_label: "Energy Charge: Block 1", source_ts: "2026-08-08T20:01:35.0000000Z" }),
      row({ charge_label: "Top Up", source_ts: "2026-08-07T10:00:00.0000000Z", cost: "500.00" })
    ]);
    expect(matchers).toEqual([]);
  });

  it("excludes refund rows that have no source_ts (unlinkable legacy captures)", () => {
    expect(refundTopupMatchers([row({ source_ts: "  " }), row({ source_ts: "" })])).toEqual([]);
  });

  it("deduplicates identical fingerprints", () => {
    const matchers = refundTopupMatchers([row({}), row({})]);
    expect(matchers).toHaveLength(1);
  });

  it("recognises any '... Refund' description generically", () => {
    const matchers = refundTopupMatchers([row({ charge_label: "Some Other Refund" })]);
    expect(matchers).toHaveLength(1);
  });
});

describe("buildRefundTopupDeletePath", () => {
  it("returns null when there are no confirmed refunds (never issues an unfiltered delete)", () => {
    expect(buildRefundTopupDeletePath("conn-1", [])).toBeNull();
  });

  it("targets only energy_rows, scoped to the connection and the 'Top Up' label", () => {
    const path = buildRefundTopupDeletePath("conn-1", refundTopupMatchers([row({})]))!;
    expect(path.startsWith("/energy_rows?")).toBe(true);
    expect(path).not.toContain("usage_activities");
    expect(path).toContain("connection_id=eq.conn-1");
    expect(path).toContain(`charge_label=eq.${encodeURIComponent("Top Up")}`);
  });

  it("pins source_ts, cost, balance and period_dt together in one and(...) group", () => {
    const path = buildRefundTopupDeletePath("conn-1", refundTopupMatchers([row({})]))!;
    const decoded = decodeURIComponent(path);
    expect(decoded).toContain(
      'and(source_ts.eq."2026-08-08T20:00:30.0071950Z",cost.eq.273.79,balance.eq.1039.47,period_dt.eq."2026-08-08 22:00")'
    );
  });

  it("does not let a genuine top-up sharing a refund's source_ts be targeted", () => {
    // Same ledger timestamp as the refund, but a real R500 wallet top-up.
    const genuineTopUp = row({ charge_label: "Top Up", cost: "500.00", balance: "1500.00" });
    // The fetch also contains the confirmed refund at that same source_ts.
    const refund = row({});

    const matchers = refundTopupMatchers([genuineTopUp, refund]);
    // Only the refund contributes a fingerprint.
    expect(matchers).toHaveLength(1);

    const decoded = decodeURIComponent(buildRefundTopupDeletePath("conn-1", matchers)!);
    // The predicate carries the refund's amount/balance, so the R500 top-up's
    // values never appear -- a timestamp collision alone cannot match it.
    expect(decoded).toContain("cost.eq.273.79");
    expect(decoded).toContain("balance.eq.1039.47");
    expect(decoded).not.toContain("500.00");
    expect(decoded).not.toContain("1500.00");
  });

  it("emits one and(...) group per distinct refund", () => {
    const path = buildRefundTopupDeletePath(
      "conn-1",
      refundTopupMatchers([
        row({ source_ts: "2026-08-08T20:00:30.0071950Z", cost: "-273.79", balance: "1039.47" }),
        row({
          source_ts: "2026-08-09T06:30:00.0000000Z",
          cost: "-12.50",
          balance: "900.00",
          period_dt: "2026-08-09 08:30"
        })
      ])
    )!;
    const decoded = decodeURIComponent(path);
    expect(decoded).toContain('source_ts.eq."2026-08-08T20:00:30.0071950Z"');
    expect(decoded).toContain('source_ts.eq."2026-08-09T06:30:00.0000000Z"');
    expect(decoded).toContain("cost.eq.12.50");
  });
});
