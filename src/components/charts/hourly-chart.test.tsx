// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
vi.mock("./chart-shell", () => ({ ChartShell: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock("recharts", () => {
  const Container = ({ children }: { children: ReactNode }) => <div>{children}</div>;
  const Empty = () => null;
  return {
    ResponsiveContainer: Container,
    BarChart: Container,
    Bar: Empty,
    CartesianGrid: Empty,
    XAxis: Empty,
    YAxis: Empty,
    Tooltip: ({ labelFormatter }: { labelFormatter: (label: string) => string }) => (
      <span>{labelFormatter("04:00")}</span>
    )
  };
});
import { HourlyChart } from "./hourly-chart";
describe("total energy hourly tooltip", () => {
  afterEach(cleanup);
  it.each(["spend", "kwh"] as const)("uses a full hour for %s without adding date text", (metric) => {
    render(<HourlyChart data={[]} metric={metric} title="Total energy" />);
    expect(screen.getByText("04:00–05:00")).toBeTruthy();
    expect(screen.queryByText("04:00–04:30")).toBeNull();
  });
});
