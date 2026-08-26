import { describe, expect, it } from "vitest";
import { chartTooltipProps } from "./chart-tooltip";

describe("chartTooltipProps", () => {
  it("overrides Recharts' black text fallback with theme tokens", () => {
    expect(chartTooltipProps.contentStyle.backgroundColor).toBe("rgb(var(--color-paper))");
    expect(chartTooltipProps.labelStyle.color).toBe("rgb(var(--color-muted))");
    expect(chartTooltipProps.itemStyle.color).toBe("rgb(var(--color-ink))");
  });
});
