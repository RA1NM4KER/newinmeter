// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it } from "vitest";
import { EngagementPanel } from "./engagement-panel";
import type { EngagementMetrics } from "@/lib/engagement";

const sampleMetrics: EngagementMetrics = {
  totalRealUsers: 17,
  activeToday: 3,
  activeLast7Days: 9,
  activeLast30Days: 12,
  adoption: {
    activities: { users: 8, percentage: 47 },
    alertsEnabled: { users: 4, percentage: 24 },
    push: { users: 6, percentage: 35 },
    ai: { users: 2, percentage: 12 },
    livemopay: { users: 15, percentage: 88 }
  }
};

function renderPanel(metrics: EngagementMetrics = sampleMetrics) {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <EngagementPanel metrics={metrics} />
    </QueryClientProvider>
  );
}

describe("EngagementPanel", () => {
  afterEach(cleanup);

  it("shows compact human-activity and clearly labelled domain adoption metrics", () => {
    renderPanel();

    expect(screen.getByText("Foreground app use only · SAST calendar days")).toBeTruthy();
    expect(screen.getByText("Alerts enabled")).toBeTruthy();
    expect(screen.getByText("8 / 17")).toBeTruthy();
    expect(screen.getByText("47%")).toBeTruthy();
    expect(screen.getByText(/no historical activity is inferred from sign-ins or syncs/i)).toBeTruthy();
  });

  it("does not fetch or show the per-user email list until a row is expanded", () => {
    renderPanel();
    expect(screen.queryByText("No one yet.")).toBeNull();
    expect(screen.getByRole("button", { name: /Alerts enabled/, expanded: false })).toBeDefined();
  });

  it("expands an adoption row on click", () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /Alerts enabled/, expanded: false }));
    expect(screen.getByRole("button", { name: /Alerts enabled/, expanded: true })).toBeDefined();
  });
});
