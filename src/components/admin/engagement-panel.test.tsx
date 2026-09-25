// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
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
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

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

  it("does not fetch or show the per-user email list until an activity tile is expanded", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    renderPanel();
    expect(screen.getByRole("button", { name: /Today/, expanded: false })).toBeDefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not show a chevron or click target when an activity count is zero", () => {
    renderPanel({ ...sampleMetrics, activeToday: 0 });

    expect(screen.queryByRole("button", { name: /Today/ })).toBeNull();
  });

  it("expands the Today activity tile and loads only that window's users", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ users: [{ userId: "real-a", email: "a@example.com" }] })
    });
    vi.stubGlobal("fetch", fetchMock);
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /Today/, expanded: false }));
    expect(screen.getByRole("button", { name: /Today/, expanded: true })).toBeDefined();
    expect(screen.getByRole("button", { name: /Last 7 days/, expanded: false })).toBeDefined();
    await waitFor(() => expect(screen.getByText("a@example.com")).toBeDefined());
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/engagement/today/users", { cache: "no-store" });
  });

  it("stays open while its user list is scrolled", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ users: [{ userId: "real-a", email: "a@example.com" }] }) })
    );
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /Today/, expanded: false }));

    const popover = await screen.findByRole("dialog", { name: "Today active users" });
    fireEvent.scroll(popover);

    expect(screen.getByRole("dialog", { name: "Today active users" })).toBeDefined();
  });
});
