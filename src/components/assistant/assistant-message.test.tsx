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

describe("AssistantMessage", () => {
  it("renders a user turn as its own bubble, with no evidence/action UI", () => {
    renderTurn({ id: "t1", role: "user", content: "Why was yesterday expensive?" });
    expect(screen.queryByText("Why was yesterday expensive?")).not.toBeNull();
    expect(screen.queryByText("Based on")).toBeNull();
  });

  it("renders the answer, evidence chips, and suggestions for an assistant turn -- and never a raw tool name anywhere", () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ rows: [] }) }));

    renderTurn({
      id: "t2",
      role: "assistant",
      content: "Yesterday was 38% above your recent average.",
      response: {
        answer: "Yesterday was 38% above your recent average.",
        evidence: [
          { type: "day", date: "2026-08-20", label: "Aug 20" },
          { type: "period", from: "2026-08-13", to: "2026-08-19", label: "Previous week" }
        ],
        visualizations: [],
        actions: [],
        suggestions: ["Why was it high?", "Add an activity for that window"],
        scope: { from: "2026-08-01", to: "2026-08-20" },
        toolsUsed: ["explain_day", "compare_previous_period", "get_top_hours"]
      }
    });

    expect(screen.queryByText("Yesterday was 38% above your recent average.")).not.toBeNull();
    expect(screen.queryByText("Aug 20")).not.toBeNull();
    expect(screen.queryByText("Previous week")).not.toBeNull();
    expect(screen.queryByText("Why was it high?")).not.toBeNull();

    // The whole point of AI v2's rendering contract: no developer-facing
    // "Used: tool_a, tool_b" text, and no raw tool identifier anywhere in
    // the rendered output.
    expect(screen.queryByText(/Used:/i)).toBeNull();
    expect(document.body.textContent).not.toContain("explain_day");
    expect(document.body.textContent).not.toContain("compare_previous_period");
    expect(document.body.textContent).not.toContain("get_top_hours");
  });

  it("clicking a suggestion chip calls onSuggestion with its exact text", () => {
    const onSuggestion = vi.fn();
    renderTurn(
      {
        id: "t3",
        role: "assistant",
        content: "Answer.",
        response: {
          answer: "Answer.",
          evidence: [],
          visualizations: [],
          actions: [],
          suggestions: ["How long will my balance last?"],
          scope: { from: "", to: "" },
          toolsUsed: []
        }
      },
      onSuggestion
    );

    fireEvent.click(screen.getByRole("button", { name: "How long will my balance last?" }));
    expect(onSuggestion).toHaveBeenCalledWith("How long will my balance last?");
  });
});
