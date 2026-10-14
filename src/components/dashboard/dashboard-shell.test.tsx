// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DashboardShell } from "./dashboard-shell";
import { formatCurrency } from "@/lib/format";
import type { DailyRollupRow } from "@/lib/types";

const filters = vi.hoisted(() => ({ from: "2026-10-01", to: "2026-10-02" }));
vi.mock("@/lib/url-state/use-filter-url-state", () => ({
  useFilterUrlState: () => ({
    ...filters,
    quickRange: "custom",
    isPending: false,
    onDateChange: vi.fn(),
    onQuickRange: vi.fn()
  })
}));
vi.mock("./filter-bar", () => ({
  FilterBar: ({ loading }: { loading: boolean }) => <div data-testid="filters" data-loading={String(loading)} />
}));
vi.mock("@/components/ui/metric-card", () => ({
  MetricCard: ({ label, value }: { label: string; value: string }) => <div data-testid={label}>{value}</div>
}));
vi.mock("@/components/assistant/assistant-panel", () => ({ AssistantPanel: () => <div>AssistantPanel</div> }));
vi.mock("@/components/data/data-sync-action", () => ({ DataSyncAction: () => <div>DataSyncAction</div> }));
vi.mock("@/components/ui/scroll-hint", () => ({ ScrollHint: () => <div>ScrollHint</div> }));
vi.mock("./install-promo-card", () => ({ InstallPromoCard: () => <div>InstallPromoCard</div> }));
vi.mock("./feature-prompt-cards", () => ({
  DashboardPromptCard: () => <div>DashboardPromptCard</div>,
  WelcomeBackCard: () => <div>WelcomeBackCard</div>
}));
vi.mock("./insights", () => ({ Insights: () => <div>Insights</div> }));
vi.mock("@/components/charts/cumulative-spend-chart", () => ({
  CumulativeSpendChart: () => <div>CumulativeSpendChart</div>
}));
vi.mock("@/components/charts/day-breakdown-chart", () => ({ DayBreakdownChart: () => <div>DayBreakdownChart</div> }));
vi.mock("@/components/charts/daily-kwh-chart", () => ({ DailyKwhChart: () => <div>DailyKwhChart</div> }));
vi.mock("@/components/charts/daily-spend-chart", () => ({ DailySpendChart: () => <div>DailySpendChart</div> }));
vi.mock("@/components/charts/hourly-chart", () => ({ HourlyChart: () => <div>HourlyChart</div> }));
vi.mock("@/components/charts/tariff-chart", () => ({ TariffChart: () => <div>TariffChart</div> }));

const row = (periodDate: string, totalSpend: number): DailyRollupRow => ({
  periodDate,
  totalSpend,
  energySpend: totalSpend,
  waterSpend: 0,
  fixedSpend: 0,
  topupAmount: 0,
  energyKwh: 2,
  waterKl: 0,
  weightedTariff: 1,
  peakTariff: 1,
  allInRate: 1,
  balanceEnd: 200,
  energyIntervals: 48,
  waterIntervals: 0,
  isComplete: true
});
let requests: Map<string, (response: Response) => void>;
let client: QueryClient;
function resolve(section: string, data: unknown, status = 200) {
  const respond = requests.get(section);
  if (!respond) throw new Error(`No request for ${section}`);
  respond(new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } }));
}
function mount() {
  return render(
    <QueryClientProvider client={client}>
      <DashboardShell userId="user-a" revision="sync-a" isAiAssistantEnabled={false} />
    </QueryClientProvider>
  );
}
beforeEach(() => {
  filters.from = "2026-10-01";
  filters.to = "2026-10-02";
  requests = new Map();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => new Promise<Response>((resolve) => requests.set(url.split("/").at(-1)!, resolve)))
  );
});
afterEach(() => {
  cleanup();
  client.clear();
  vi.unstubAllGlobals();
});

describe("progressive dashboard", () => {
  it("shows balance and totals independently, while hourly and prompts still load", async () => {
    mount();
    await waitFor(() => expect(requests.size).toBe(4));
    resolve("summary", { dateStart: "2026-10-01", dateEnd: "2026-10-02", latestBalance: 300 });
    await waitFor(() => expect(screen.getByTestId("Latest balance").textContent).toBe(formatCurrency(300)));
    expect(screen.queryByTestId("Total spend")).toBeNull();
    resolve("daily", [row("2026-10-01", 10), row("2026-10-02", 20)]);
    await waitFor(() => expect(screen.getByTestId("Total spend").textContent).toBe(formatCurrency(30)));
    expect(screen.getByLabelText("Loading daily spend")).toBeTruthy();
    expect(screen.getByText("DayBreakdownChart")).toBeTruthy();
    expect(screen.getByTestId("filters").getAttribute("data-loading")).toBe("true");
    resolve("hourly", []);
    await waitFor(() => expect(screen.getByText("DailySpendChart")).toBeTruthy());
    expect(screen.getByTestId("filters").getAttribute("data-loading")).toBe("true");
    resolve("prompts", { alertRules: [], featureAdoption: null, featureRates: {}, promptDay: "2026-10-14" });
    await waitFor(() => expect(screen.getByTestId("filters").getAttribute("data-loading")).toBe("false"));
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it("keeps ready sections usable when one fails, stops loading, and retries only the failed resource", async () => {
    mount();
    await waitFor(() => expect(requests.size).toBe(4));
    resolve("summary", { dateStart: "2026-10-01", dateEnd: "2026-10-02", latestBalance: 300 });
    resolve("daily", [row("2026-10-01", 10)]);
    resolve("hourly", []);
    resolve("prompts", {}, 500);
    await waitFor(() => expect(screen.getByText("Unable to load suggestions.")).toBeTruthy());
    expect(screen.getByTestId("Total spend").textContent).toBe(formatCurrency(10));
    expect(screen.getByTestId("filters").getAttribute("data-loading")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(5));
    expect(vi.mocked(fetch).mock.calls.at(-1)?.[0]).toBe("/api/dashboard/prompts");
    resolve("prompts", { alertRules: [], featureAdoption: null, featureRates: {}, promptDay: "2026-10-14" });
    await waitFor(() => expect(screen.queryByText("Unable to load suggestions.")).toBeNull());
  });

  it("uses the latest range when pending data arrives, without refetching all rollups", async () => {
    const view = mount();
    await waitFor(() => expect(requests.size).toBe(4));
    filters.from = "2026-10-02";
    filters.to = "2026-10-02";
    view.rerender(
      <QueryClientProvider client={client}>
        <DashboardShell userId="user-a" revision="sync-a" isAiAssistantEnabled={false} />
      </QueryClientProvider>
    );
    filters.from = "2026-10-01";
    filters.to = "2026-10-01";
    view.rerender(
      <QueryClientProvider client={client}>
        <DashboardShell userId="user-a" revision="sync-a" isAiAssistantEnabled={false} />
      </QueryClientProvider>
    );
    resolve("summary", { dateStart: "2026-10-01", dateEnd: "2026-10-02" });
    resolve("daily", [row("2026-10-01", 10), row("2026-10-02", 20)]);
    await waitFor(() => expect(screen.getByTestId("Total spend").textContent).toBe(formatCurrency(10)));
    expect(fetch).toHaveBeenCalledTimes(4);
  });
  it("does not reuse another user's dashboard or a previous sync revision", async () => {
    const view = mount();
    await waitFor(() => expect(requests.size).toBe(4));
    resolve("summary", { dateStart: "2026-10-01", dateEnd: "2026-10-02", latestBalance: 300 });
    resolve("daily", [row("2026-10-01", 10)]);
    await waitFor(() => expect(screen.getByTestId("Latest balance").textContent).toBe(formatCurrency(300)));
    view.rerender(
      <QueryClientProvider client={client}>
        <DashboardShell userId="user-b" revision="sync-b" isAiAssistantEnabled={false} />
      </QueryClientProvider>
    );
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(8));
    expect(screen.queryByTestId("Latest balance")).toBeNull();
    resolve("summary", { dateStart: "2026-10-01", dateEnd: "2026-10-02", latestBalance: 700 });
    await waitFor(() => expect(screen.getByTestId("Latest balance").textContent).toBe(formatCurrency(700)));
    view.rerender(
      <QueryClientProvider client={client}>
        <DashboardShell userId="user-b" revision="sync-c" isAiAssistantEnabled={false} />
      </QueryClientProvider>
    );
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(12));
    expect(screen.queryByTestId("Latest balance")).toBeNull();
  });
});
