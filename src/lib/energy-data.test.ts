import { describe, expect, it } from "vitest";
import { contentRangeTotal, orderClauseForQuery, queryPathForPage, searchFilterOrClause } from "@/lib/energy-data";

describe("searchFilterOrClause", () => {
  it("returns an empty string for blank input (no filter applied)", () => {
    expect(searchFilterOrClause("")).toBe("");
    expect(searchFilterOrClause("   ")).toBe("");
  });

  it("builds an ilike OR clause across the searchable columns", () => {
    expect(searchFilterOrClause("top up")).toBe(
      "charge_label.ilike.*top up*,period_dt.ilike.*top up*,capture_dt.ilike.*top up*"
    );
  });

  it("strips PostgREST wildcard characters from user input so they can't inject their own pattern", () => {
    // A literal "*" in the search term would otherwise let a user widen
    // their own ilike pattern arbitrarily (e.g. "*" alone would match
    // everything) -- confirm it's stripped, not passed through.
    expect(searchFilterOrClause("a*b")).toBe("charge_label.ilike.*ab*,period_dt.ilike.*ab*,capture_dt.ilike.*ab*");
  });

  it("trims surrounding whitespace before building the clause", () => {
    expect(searchFilterOrClause("  fee  ")).toBe(
      "charge_label.ilike.*fee*,period_dt.ilike.*fee*,capture_dt.ilike.*fee*"
    );
  });
});

describe("orderClauseForQuery", () => {
  it("defaults to sorting by captured, descending", () => {
    expect(orderClauseForQuery()).toBe("source_ts.desc.nullslast,capture_ts.desc,period_ts.desc");
  });

  it("sorts by period when requested", () => {
    expect(orderClauseForQuery("period", "asc")).toBe("period_ts.asc,source_ts.desc.nullslast,capture_ts.desc");
  });

  it("falls back to descending for an invalid direction rather than throwing", () => {
    // sortDirection is typed as SortDirection, but PostgREST-facing code
    // should still degrade safely if something upstream passes garbage.
    expect(orderClauseForQuery("amount", "sideways" as never)).toContain("cost.desc");
  });

  it("uses a distinct column mapping for type vs band despite sharing the same source column", () => {
    // Both "type" and "band" sort by charge_label under the hood -- confirm
    // that mapping is intentional and both keys still produce a valid clause.
    expect(orderClauseForQuery("type", "asc")).toContain("charge_label.asc");
    expect(orderClauseForQuery("band", "asc")).toContain("charge_label.asc");
  });
});

describe("queryPathForPage", () => {
  it("builds a base path with select and order params", () => {
    const path = queryPathForPage({});
    expect(path.startsWith("/energy_rows?")).toBe(true);
    expect(path).toContain("select=capture_dt%2Ccharge_label%2Cperiod_dt%2Ckwh%2Cwater_kl%2Ctariff%2Ccost%2Cbalance");
  });

  it("adds inclusive from/to date bounds", () => {
    const path = queryPathForPage({ from: "2026-07-01", to: "2026-07-31" });
    expect(path).toContain("period_dt=gte.2026-07-01+00%3A00%3A00");
    expect(path).toContain("period_dt=lte.2026-07-31+23%3A59%3A59");
  });

  it("filters by charge type for energy, water, and topup", () => {
    expect(queryPathForPage({ chargeType: "energy" })).toContain("charge_label=like.Energy+Charge%3A*");
    expect(queryPathForPage({ chargeType: "water" })).toContain("charge_label=like.Water%3A*");
    expect(queryPathForPage({ chargeType: "topup" })).toContain("charge_label=eq.Top+Up");
  });

  it("excludes energy, water, and topup labels for the fixed filter (fixed has no dedicated label prefix)", () => {
    const path = queryPathForPage({ chargeType: "fixed" });
    expect(path).toContain("charge_label=not.like.Energy+Charge%3A*");
    expect(path).toContain("charge_label=not.like.Water%3A*");
    expect(path).toContain("charge_label=neq.Top+Up");
  });

  it("applies no charge_label filter param for 'all' (charge_label still appears in the select list)", () => {
    expect(queryPathForPage({ chargeType: "all" })).not.toContain("charge_label=");
  });

  it("includes the search clause when a search term is given", () => {
    const path = queryPathForPage({ search: "fee" });
    expect(path).toContain("or=");
    expect(decodeURIComponent(path)).toContain("charge_label.ilike.*fee*");
  });
});

describe("contentRangeTotal", () => {
  it("parses the total out of a PostgREST Content-Range header", () => {
    expect(contentRangeTotal("0-24/137")).toBe(137);
  });

  it("returns 0 for a null header", () => {
    expect(contentRangeTotal(null)).toBe(0);
  });

  it("returns 0 for an unparseable header instead of NaN", () => {
    expect(contentRangeTotal("garbage")).toBe(0);
    expect(Number.isNaN(contentRangeTotal("garbage"))).toBe(false);
  });
});
