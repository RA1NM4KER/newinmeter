// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ tooltip: vi.fn((_props: Record<string, unknown>) => null) }));

vi.mock("recharts", () => ({ Tooltip: mocks.tooltip }));

import { ChartTooltip } from "./chart-tooltip";

describe("ChartTooltip", () => {
  it("forwards hover formatting while overriding Recharts' black text fallback with theme tokens", () => {
    const formatter = vi.fn();
    const labelFormatter = vi.fn();

    render(<ChartTooltip formatter={formatter} labelFormatter={labelFormatter} />);

    const props = mocks.tooltip.mock.calls[0][0] as {
      formatter: unknown;
      labelFormatter: unknown;
      contentStyle: Record<string, string>;
      labelStyle: Record<string, string>;
      itemStyle: Record<string, string>;
    };
    expect(props.formatter).toBe(formatter);
    expect(props.labelFormatter).toBe(labelFormatter);
    expect(props.contentStyle.backgroundColor).toBe("rgb(var(--color-paper))");
    expect(props.labelStyle.color).toBe("rgb(var(--color-muted))");
    expect(props.itemStyle.color).toBe("rgb(var(--color-ink))");
  });
});
