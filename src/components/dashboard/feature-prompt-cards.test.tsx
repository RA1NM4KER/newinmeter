// @vitest-environment jsdom
import { StrictMode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DailyRollupRow } from "@/lib/types";

const mocks = vi.hoisted(() => ({
  open: vi.fn()
}));

vi.mock("@/components/assistant/assistant-provider", () => ({
  useAssistant: () => ({ open: mocks.open })
}));

import { DashboardPromptCard, WelcomeBackCard } from "./feature-prompt-cards";

const DAY_MS = 24 * 60 * 60 * 1000;
const LAST_VISIT_KEY = "newinmeter:dashboard-last-visit-at";

function row(periodDate: string, totalSpend: number, energyKwh: number): DailyRollupRow {
  return {
    periodDate,
    energySpend: totalSpend,
    waterSpend: 0,
    fixedSpend: 0,
    topupAmount: 0,
    totalSpend,
    energyKwh,
    waterKl: 0,
    weightedTariff: 0,
    peakTariff: 0,
    allInRate: 0,
    balanceEnd: 0,
    energyIntervals: 0,
    waterIntervals: 0,
    isComplete: true
  };
}

const rows = [row("2026-09-27", 20, 2), row("2026-09-28", 30, 3), row("2026-09-29", 40, 4)];

// Shared props for the prompt card: a fresh user with AI and Activities unused,
// no alerts on, and nothing crossing a threshold. Under that setup the only
// eligible prompts are AI and Activities, so the test does not depend on which
// one the daily pick lands on.
const promptBase = {
  rules: [],
  latestBalance: 1000,
  dailyRows: [],
  adoption: { aiUsed: false, activitiesUsed: false },
  rates: {},
  dayKey: "2026-10-04",
  alertsAvailable: false,
  aiAvailable: true,
  activitiesAvailable: true,
  from: "2026-07-04",
  to: "2026-10-04",
  isDemo: false
};

beforeEach(() => {
  window.localStorage.clear();
  mocks.open.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("WelcomeBackCard", () => {
  beforeEach(() => {
    // Keep the last visit before the fixed September rows as real time moves on.
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-04T12:00:00.000Z"));
  });
  afterEach(() => vi.restoreAllMocks());

  it("shows the summary after a visit 8 days ago, even under StrictMode's double effect run", async () => {
    window.localStorage.setItem(LAST_VISIT_KEY, String(Date.now() - 8 * DAY_MS));

    render(
      <StrictMode>
        <WelcomeBackCard dailyRows={rows} isDemo={false} />
      </StrictMode>
    );

    // Without the captured-visit ref, the second strict-mode effect run would
    // read the timestamp the first run just wrote and hide the card.
    expect(await screen.findByText("Welcome back")).toBeTruthy();
    expect(screen.getByText("Since your last visit 8 days ago")).toBeTruthy();
  });

  it("does not show on a first-ever visit", async () => {
    render(<WelcomeBackCard dailyRows={rows} isDemo={false} />);
    await waitFor(() => expect(window.localStorage.getItem(LAST_VISIT_KEY)).not.toBeNull());
    expect(screen.queryByText("Welcome back")).toBeNull();
  });

  it("does not show on the demo account", async () => {
    window.localStorage.setItem(LAST_VISIT_KEY, String(Date.now() - 8 * DAY_MS));
    render(<WelcomeBackCard dailyRows={rows} isDemo />);
    await waitFor(() => expect(window.localStorage.getItem(LAST_VISIT_KEY)).not.toBeNull());
    expect(screen.queryByText("Welcome back")).toBeNull();
  });

  it("hides when dismissed", async () => {
    window.localStorage.setItem(LAST_VISIT_KEY, String(Date.now() - 8 * DAY_MS));
    render(<WelcomeBackCard dailyRows={rows} isDemo={false} />);
    fireEvent.click(await screen.findByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText("Welcome back")).toBeNull();
  });
});

describe("DashboardPromptCard", () => {
  it("shows one prompt at a time, moves to the other feature on dismiss, and goes quiet after both", async () => {
    render(<DashboardPromptCard {...promptBase} />);

    // For this user both AI and Activities are eligible; the daily pick chooses
    // one. Whichever it is, dismissing it must bring up the other, not a blank.
    const first = await screen.findByRole("button", { name: "Dismiss" });
    const firstTitle = screen.queryByText("Ask your energy assistant") ? "ai" : "activities";
    expect(screen.getAllByRole("button", { name: "Dismiss" })).toHaveLength(1);

    fireEvent.click(first);
    const second = await screen.findByRole("button", { name: "Dismiss" });
    const secondTitle = screen.queryByText("Ask your energy assistant") ? "ai" : "activities";
    expect(secondTitle).not.toBe(firstTitle);

    fireEvent.click(second);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Dismiss" })).toBeNull());
  });

  it("opens the assistant from the AI prompt button", async () => {
    render(<DashboardPromptCard {...promptBase} alertsAvailable={false} activitiesAvailable={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Ask a question" }));
    expect(mocks.open).toHaveBeenCalledWith({ from: "2026-07-04", to: "2026-10-04" });
  });

  it("shows no prompt for a demo account", () => {
    const { container } = render(<DashboardPromptCard {...promptBase} isDemo />);
    expect(container.querySelector("section")).toBeNull();
  });
});
