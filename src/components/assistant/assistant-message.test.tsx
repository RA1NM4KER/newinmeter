// @vitest-environment jsdom
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AssistantTurn } from "./assistant-provider";
import { AssistantProvider } from "./assistant-provider";
import { AssistantMessage } from "./assistant-message";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderTurn(turn: AssistantTurn, onSuggestion = vi.fn()) {
  return render(
    <AssistantProvider isEnabled isActivitiesEnabled isAlertsEnabled isDemo={false}>
      <AssistantMessage onSuggestion={onSuggestion} turn={turn} />
    </AssistantProvider>
  );
}

function richTurn(overrides: Partial<NonNullable<AssistantTurn["response"]>> = {}): AssistantTurn {
  return {
    id: "t2",
    role: "assistant",
    content: "Yesterday was 38% above your recent average.",
    response: {
      headline: "Yesterday was 38% above your recent average.",
      metrics: [
        { label: "Spend", value: "R84.20" },
        { label: "Usage", value: "18.6 kWh" }
      ],
      body: [{ heading: "20:00-22:00", text: "This was the largest evening spike." }],
      evidence: [
        { type: "day", date: "2026-08-20", label: "Aug 20" },
        { type: "period", from: "2026-08-13", to: "2026-08-19", label: "Previous week" }
      ],
      visualizations: [],
      actions: [],
      suggestions: ["Why was it high?", "Compare to last week"],
      scope: { from: "2026-08-01", to: "2026-08-20" },
      toolsUsed: ["explain_day", "compare_previous_period", "get_top_hours"],
      ...overrides
    }
  };
}

describe("AssistantMessage", () => {
  it("renders a user turn as its own bubble, with no evidence/action UI", () => {
    renderTurn({ id: "t1", role: "user", content: "Why was yesterday expensive?" });
    expect(screen.queryByText("Why was yesterday expensive?")).not.toBeNull();
    expect(screen.queryByText("Based on")).toBeNull();
  });

  it("renders headline, metrics, and body blocks -- and never a raw tool name anywhere", () => {
    renderTurn(richTurn());

    expect(screen.queryByText("Yesterday was 38% above your recent average.")).not.toBeNull();
    expect(screen.queryByText("R84.20")).not.toBeNull();
    expect(screen.queryByText("18.6 kWh")).not.toBeNull();
    expect(screen.queryByText("20:00-22:00")).not.toBeNull();
    expect(screen.queryByText("This was the largest evening spike.")).not.toBeNull();

    // The whole point of AI v2's rendering contract: no developer-facing
    // "Used: tool_a, tool_b" text, and no raw tool identifier anywhere in
    // the rendered output.
    expect(screen.queryByText(/Used:/i)).toBeNull();
    expect(document.body.textContent).not.toContain("explain_day");
    expect(document.body.textContent).not.toContain("compare_previous_period");
    expect(document.body.textContent).not.toContain("get_top_hours");
  });

  it("evidence is collapsed behind a 'Sources · N' disclosure, never shown as a 'BASED ON' row of raw source labels", () => {
    renderTurn(richTurn());

    // Not visible until expanded.
    expect(screen.queryByText("BASED ON")).toBeNull();
    expect(screen.queryByText("Based on")).toBeNull();
    expect(screen.queryByText("Aug 20")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Sources · 2/ }));
    expect(screen.queryByText("Aug 20")).not.toBeNull();
    expect(screen.queryByText("Previous week")).not.toBeNull();
  });

  it("filters out a generic 'Dashboard scope' evidence entry even if the model emits one", () => {
    renderTurn(
      richTurn({
        evidence: [
          { type: "data_status", label: "Dashboard scope" },
          { type: "day", date: "2026-08-20", label: "Aug 20 usage" }
        ]
      })
    );

    fireEvent.click(screen.getByRole("button", { name: /Sources · 1/ }));
    expect(screen.queryByText("Aug 20 usage")).not.toBeNull();
    expect(screen.queryByText("Dashboard scope")).toBeNull();
  });

  it("shows at most 2 follow-up suggestions even when the model returns more", () => {
    renderTurn(richTurn({ suggestions: ["First one", "Second one", "Third one"] }));

    expect(screen.queryByRole("button", { name: "First one" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Second one" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Third one" })).toBeNull();
  });

  it("clicking a suggestion calls onSuggestion with its exact text", () => {
    const onSuggestion = vi.fn();
    renderTurn(richTurn({ suggestions: ["How long will my balance last?"] }), onSuggestion);

    fireEvent.click(screen.getByRole("button", { name: "How long will my balance last?" }));
    expect(onSuggestion).toHaveBeenCalledWith("How long will my balance last?");
  });

  it("renders nothing extra when metrics/body/evidence/suggestions are all empty", () => {
    renderTurn(richTurn({ metrics: [], body: [], evidence: [], suggestions: [] }));
    expect(screen.queryByText(/Sources/)).toBeNull();
    expect(screen.queryByText(/Explore next/)).toBeNull();
  });
});
