// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it } from "vitest";
import { AdminFeaturesPanel } from "./admin-features-panel";
import type { AdminFeaturesApiResponse, FeatureRow } from "./types";

function feature(overrides: Partial<FeatureRow> = {}): FeatureRow {
  return {
    key: "alerts",
    name: "Alerts",
    short: "Alerts",
    description: "Proactive usage and spending alerts.",
    mode: "everyone",
    enabledCount: 14,
    totalCount: 14,
    ...overrides
  };
}

function renderWithClient(data: AdminFeaturesApiResponse) {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <AdminFeaturesPanel initialData={data} />
    </QueryClientProvider>
  );
}

describe("AdminFeaturesPanel", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders one row per feature, with its name, mode, and effective-access count", () => {
    renderWithClient({
      features: [
        feature({ key: "ai", name: "AI Assistant", mode: "everyone", enabledCount: 14, totalCount: 14 }),
        feature({ key: "activities", name: "Activities", mode: "selected", enabledCount: 4, totalCount: 14 }),
        feature({ key: "live", name: "Live Meter", mode: "selected", enabledCount: 1, totalCount: 14 }),
        feature({ key: "alerts", name: "Alerts", mode: "everyone", enabledCount: 14, totalCount: 14 })
      ]
    });

    expect(screen.getByText("AI Assistant")).toBeDefined();
    expect(screen.getByText("Activities")).toBeDefined();
    expect(screen.getByText("Live Meter")).toBeDefined();
    expect(screen.getByText("Alerts")).toBeDefined();

    // Counts are effective-access counts (see the API/lib layer's own
    // tests for the everyone-minus-revokes / selected-only-grants math);
    // this just confirms they render as passed.
    expect(screen.getByText("4 / 14")).toBeDefined();
    expect(screen.getByText("1 / 14")).toBeDefined();
    expect(screen.getAllByText("14 / 14")).toHaveLength(2);
  });

  it("does not show a rollout control or override list until a row is expanded", () => {
    renderWithClient({ features: [feature()] });
    expect(screen.queryByRole("radiogroup")).toBeNull();
  });

  it("expands a row on click to reveal its rollout control", () => {
    renderWithClient({ features: [feature()] });
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(screen.getByRole("radiogroup")).toBeDefined();
    expect(screen.getByRole("radio", { name: "Everyone" })).toBeDefined();
    expect(screen.getByRole("radio", { name: "Selected users" })).toBeDefined();
    expect(screen.getByRole("radio", { name: "Off" })).toBeDefined();
  });
});
