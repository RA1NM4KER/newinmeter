import { describe, expect, it } from "vitest";
import { buildActivitySearchParams, parseActivityQuery, replaceActivityTagParams } from "./query-params";

describe("activity query parameters", () => {
  it("parses date, tags, metric, and utility safely", () => {
    const params = new URLSearchParams(
      "date=2026-08-04&tag=Geyser&tag=geyser&tags=heater,Guests&metric=averageKw&utility=water"
    );
    expect(parseActivityQuery(params)).toEqual({
      from: "2026-08-04",
      to: "2026-08-04",
      date: "2026-08-04",
      tags: ["geyser", "heater", "guests"],
      metric: "averageKw",
      utility: "water"
    });
  });

  it("falls back to the default metric and builds repeated tag parameters", () => {
    expect(parseActivityQuery(new URLSearchParams("metric=wat"))).toMatchObject({
      metric: "electricityKwh",
      utility: "all"
    });
    expect(
      buildActivitySearchParams({ from: "2026-08-01", to: "2026-08-04", tags: ["Geyser", "geyser"] }).toString()
    ).toBe("from=2026-08-01&to=2026-08-04&tag=geyser");
  });

  it("replaces selected tags without losing other URL filters", () => {
    const current = new URLSearchParams("from=2026-08-01&to=2026-08-04&tag=old&tags=legacy,values&metric=averageKw");

    expect(replaceActivityTagParams(current, [" Geyser ", "geyser", "Heater"]).toString()).toBe(
      "from=2026-08-01&to=2026-08-04&metric=averageKw&tag=geyser&tag=heater"
    );
    expect(replaceActivityTagParams(current, []).toString()).toBe("from=2026-08-01&to=2026-08-04&metric=averageKw");
  });
});
