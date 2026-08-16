import { describe, expect, it } from "vitest";
import { dateRangeQueryUpdates, filterQueryParamKeys, parseDateRangeQuery } from "@/lib/filter-query-params";

describe("parseDateRangeQuery", () => {
  it("passes through valid ISO dates", () => {
    const params = new URLSearchParams("from=2026-01-01&to=2026-02-01");
    expect(parseDateRangeQuery(params)).toEqual({ from: "2026-01-01", to: "2026-02-01" });
  });

  it("rejects a range whose To date is before its From date", () => {
    const params = new URLSearchParams("from=2026-02-01&to=2026-01-31");
    expect(parseDateRangeQuery(params)).toEqual({ from: "", to: "" });
  });

  it("accepts an equal From and To date", () => {
    const params = new URLSearchParams("from=2026-02-01&to=2026-02-01");
    expect(parseDateRangeQuery(params)).toEqual({ from: "2026-02-01", to: "2026-02-01" });
  });

  it("defaults to empty strings when params are missing", () => {
    expect(parseDateRangeQuery(new URLSearchParams(""))).toEqual({ from: "", to: "" });
  });

  it("drops malformed dates instead of passing them through", () => {
    const params = new URLSearchParams("from=not-a-date&to=2026-13-99");
    // "2026-13-99" matches the YYYY-MM-DD shape but isn't a real calendar
    // date (month 13, day 99) -- rejected via a round-trip through Date's
    // own calendar math, not just the regex shape.
    expect(parseDateRangeQuery(params)).toEqual({ from: "", to: "" });
  });

  it("rejects dates that overflow their month (e.g. Feb 30)", () => {
    const params = new URLSearchParams("from=2026-02-30");
    expect(parseDateRangeQuery(params).from).toBe("");
  });

  it("accepts a real leap day", () => {
    const params = new URLSearchParams("from=2024-02-29");
    expect(parseDateRangeQuery(params).from).toBe("2024-02-29");
  });

  it("rejects Feb 29 on a non-leap year", () => {
    const params = new URLSearchParams("from=2026-02-29");
    expect(parseDateRangeQuery(params).from).toBe("");
  });

  it("trims whitespace before validating", () => {
    const params = new URLSearchParams();
    params.set("from", "  2026-01-01  ");
    expect(parseDateRangeQuery(params).from).toBe("2026-01-01");
  });

  it("rejects a trimmed value that isn't ISO shaped even with whitespace", () => {
    const params = new URLSearchParams();
    params.set("from", "  01/01/2026  ");
    expect(parseDateRangeQuery(params).from).toBe("");
  });
});

describe("dateRangeQueryUpdates", () => {
  it("maps from/to onto the query param keys", () => {
    expect(dateRangeQueryUpdates("2026-01-01", "2026-02-01")).toEqual({
      [filterQueryParamKeys.from]: "2026-01-01",
      [filterQueryParamKeys.to]: "2026-02-01"
    });
  });

  it("maps empty strings to null so callers clear the param", () => {
    expect(dateRangeQueryUpdates("", "")).toEqual({
      [filterQueryParamKeys.from]: null,
      [filterQueryParamKeys.to]: null
    });
  });
});
