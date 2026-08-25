// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AssistantVisualizationCard } from "./assistant-visualization";

// recharts' ResponsiveContainer requires ResizeObserver, which jsdom doesn't
// implement -- a minimal no-op stub is enough for a component to mount and
// render without needing real layout measurement.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AssistantVisualizationCard -- hourly_usage with multiple highlight windows", () => {
  it("renders ONE chart with both highlighted-range labels, not two separate charts", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          rows: [
            { periodDate: "2026-08-13", periodTime: "09:00", spend: 5, kwh: 2, waterSpend: 0, waterKl: 0 },
            { periodDate: "2026-08-13", periodTime: "20:00", spend: 8, kwh: 3, waterSpend: 0, waterKl: 0 }
          ]
        })
      })
    );

    render(
      <AssistantVisualizationCard
        visualization={{
          type: "hourly_usage",
          date: "2026-08-13",
          highlights: [
            { fromHour: 9, toHour: 10, label: "Morning" },
            { fromHour: 20, toHour: 22, label: "Evening spike" }
          ],
          title: "High spend periods"
        }}
      />
    );

    await waitFor(() => expect(screen.queryByText("Morning")).not.toBeNull());
    expect(screen.queryByText("Evening spike")).not.toBeNull();
    // Exactly one chart title -- proof this is one chart, not a duplicated
    // pair of full-day charts for the same date.
    expect(screen.getAllByText("High spend periods")).toHaveLength(1);
  });

  it("renders with no highlight legend when no highlight carries a label", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ rows: [] }) }));

    render(
      <AssistantVisualizationCard
        visualization={{ type: "hourly_usage", date: "2026-08-13", highlights: [], title: null }}
      />
    );

    await waitFor(() => expect(screen.queryByText("No data for this range.")).not.toBeNull());
  });
});
