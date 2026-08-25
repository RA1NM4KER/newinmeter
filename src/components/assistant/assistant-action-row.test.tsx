// @vitest-environment jsdom
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useEffect, type ComponentProps } from "react";
import type { AssistantAction } from "@/lib/assistant/types";
import { AssistantActionRow } from "./assistant-action-row";
import { AssistantProvider, useAssistant } from "./assistant-provider";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock }) }));

const { fetchActivityTagsMock } = vi.hoisted(() => ({ fetchActivityTagsMock: vi.fn() }));
vi.mock("@/lib/activity/client", () => ({ fetchActivityTags: fetchActivityTagsMock }));

function renderActions(
  actions: AssistantAction[],
  providerProps: Partial<ComponentProps<typeof AssistantProvider>> = {}
) {
  return render(
    <AssistantProvider isEnabled isActivitiesEnabled isAlertsEnabled isDemo={false} {...providerProps}>
      <AssistantActionRow actions={actions} />
    </AssistantProvider>
  );
}

// Renders AssistantActionRow alongside a live readout of the provider's own
// isOpen state, pre-opened on mount -- the only way to observe from outside
// that a navigate click actually closed the global assistant dialog, since
// AssistantActionRow itself renders no dialog.
function OpenStateHarness({ actions }: { actions: AssistantAction[] }) {
  const { isOpen, open } = useAssistant();
  useEffect(() => {
    open();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <>
      <p data-testid="open-state">{isOpen ? "open" : "closed"}</p>
      <AssistantActionRow actions={actions} />
    </>
  );
}

function renderWithOpenHarness(actions: AssistantAction[]) {
  return render(
    <AssistantProvider isEnabled isActivitiesEnabled isAlertsEnabled isDemo={false}>
      <OpenStateHarness actions={actions} />
    </AssistantProvider>
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  fetchActivityTagsMock.mockReset().mockResolvedValue({ tags: [], colors: {} });
});

describe("AssistantActionRow -- navigation", () => {
  it("navigate actions run immediately with no confirmation step, resolving the correct URL", () => {
    renderActions([
      {
        type: "navigate",
        label: "View detailed data for August 20, 2026",
        destination: { page: "data", date: "2026-08-20", from: null, to: null }
      }
    ]);

    fireEvent.click(screen.getByRole("button", { name: "View day" }));
    expect(pushMock).toHaveBeenCalledWith("/data?from=2026-08-20&to=2026-08-20");
  });

  it("closes the assistant dialog BEFORE navigating -- otherwise the destination page renders behind a still-open global overlay", async () => {
    renderWithOpenHarness([
      { type: "navigate", label: "View data", destination: { page: "data", date: "2026-08-13", from: null, to: null } }
    ]);

    await waitFor(() => expect(screen.getByTestId("open-state").textContent).toBe("open"));

    fireEvent.click(screen.getByRole("button", { name: "View day" }));

    expect(screen.getByTestId("open-state").textContent).toBe("closed");
    expect(pushMock).toHaveBeenCalledWith("/data?from=2026-08-13&to=2026-08-13");
  });

  it("navigating to the dashboard with a from/to range applies both query params", () => {
    renderActions([
      {
        type: "navigate",
        label: "x",
        destination: { page: "dashboard", from: "2026-08-01", to: "2026-08-20" }
      }
    ]);
    fireEvent.click(screen.getByRole("button", { name: "View dashboard" }));
    expect(pushMock).toHaveBeenCalledWith("/?from=2026-08-01&to=2026-08-20");
  });

  it("navigating to activities for a specific date applies it as a same-day range", () => {
    renderActions([{ type: "navigate", label: "x", destination: { page: "activities", date: "2026-08-13" } }]);
    fireEvent.click(screen.getByRole("button", { name: "View activities" }));
    expect(pushMock).toHaveBeenCalledWith("/activities?from=2026-08-13&to=2026-08-13");
  });
});

describe("AssistantActionRow -- the UI owns action button labels, not the model", () => {
  it("uses a short canonical label instead of a long model-generated one", () => {
    renderActions([
      {
        type: "navigate",
        label: "View detailed data for August 13, 2026 including hourly breakdown",
        destination: { page: "data", date: "2026-08-13", from: null, to: null }
      }
    ]);
    expect(screen.queryByRole("button", { name: /View detailed data for August/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "View day" })).not.toBeNull();
  });

  it("distinguishes 'View day' (a specific date) from 'View data' (a range with no single date)", () => {
    renderActions([
      { type: "navigate", label: "x", destination: { page: "data", date: null, from: "2026-08-01", to: "2026-08-20" } }
    ]);
    expect(screen.queryByRole("button", { name: "View data" })).not.toBeNull();
  });

  it("normalizes disable_alert to 'Turn off alert' regardless of the model's own label", () => {
    renderActions([
      { type: "disable_alert", label: "Add activity label for high evening usage", alertType: "low_balance", requiresConfirmation: true }
    ]);
    expect(screen.queryByRole("button", { name: "Turn off alert" })).not.toBeNull();
  });
});

describe("AssistantActionRow -- mutation confirmation", () => {
  it("a mutating action shows a confirmation card and performs NO network call until Confirm is clicked", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    renderActions([{ type: "sync", label: "Sync now", requiresConfirmation: true }]);

    fireEvent.click(screen.getByRole("button", { name: "Sync now" }));
    expect(screen.queryByText("Refresh data")).not.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("Cancel collapses the confirmation card without ever calling the actions endpoint", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    renderActions([{ type: "sync", label: "Sync now", requiresConfirmation: true }]);
    fireEvent.click(screen.getByRole("button", { name: "Sync now" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByText("Refresh data")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("Confirm calls POST /api/assistant/actions and shows a success state on 200", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ summary: {}, output: {} }) });
    vi.stubGlobal("fetch", fetchMock);

    renderActions([{ type: "sync", label: "Sync now", requiresConfirmation: true }]);
    fireEvent.click(screen.getByRole("button", { name: "Sync now" }));
    fireEvent.click(screen.getByRole("button", { name: "Sync now" }));

    await waitFor(() => expect(screen.queryByText("Data refreshed.")).not.toBeNull());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/assistant/actions",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ type: "sync" }) })
    );
  });

  it("shows the server's failure message inline and stays confirmable on error, without a false success state", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, json: async () => ({ message: "Sync failed." }) });
    vi.stubGlobal("fetch", fetchMock);

    renderActions([{ type: "sync", label: "Sync now", requiresConfirmation: true }]);
    fireEvent.click(screen.getByRole("button", { name: "Sync now" }));
    fireEvent.click(screen.getByRole("button", { name: "Sync now" }));

    await waitFor(() => expect(screen.queryByText("Sync failed.")).not.toBeNull());
    expect(screen.queryByText("Data refreshed.")).toBeNull();
  });

  it("set_alert lets the user edit the threshold before confirming, and sends the edited value", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ rule: {}, autoSyncEnabled: true, nextSyncAt: null }) });
    vi.stubGlobal("fetch", fetchMock);

    renderActions([
      {
        type: "set_alert",
        label: "Set R50 daily-spend alert",
        alertType: "daily_spend",
        threshold: 50,
        requiresConfirmation: true
      }
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Set alert" }));
    const input = screen.getByDisplayValue("50");
    fireEvent.change(input, { target: { value: "70" } });
    fireEvent.click(screen.getByRole("button", { name: "Set alert" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toMatchObject({ type: "set_alert", alertType: "daily_spend", threshold: 70 });
  });
});

describe("AssistantActionRow -- add_activity", () => {
  it("pre-selects the model's suggested tags as chips, and requires at least one selected before confirming", () => {
    renderActions([
      {
        type: "add_activity",
        label: "Add activity",
        date: "2026-08-20",
        start: "18:00",
        end: "19:00",
        suggestedTags: ["geyser"],
        requiresConfirmation: true
      }
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Add activity" }));
    // Suggested tag renders pre-selected, so the confirm button starts enabled.
    const confirmButton = screen.getByRole("button", { name: "Add activity" }) as HTMLButtonElement;
    expect(confirmButton.disabled).toBe(false);

    // Deselecting the only chip disables confirm again.
    fireEvent.click(screen.getByRole("button", { name: "Geyser" }));
    expect((screen.getByRole("button", { name: "Add activity" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("requires at least one tag before confirming when there is no suggested tag", () => {
    renderActions([
      {
        type: "add_activity",
        label: "Add activity",
        date: "2026-08-20",
        start: "18:00",
        end: "19:00",
        suggestedTags: [],
        requiresConfirmation: true
      }
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Add activity" }));
    const confirmButton = screen.getByRole("button", { name: "Add activity" }) as HTMLButtonElement;
    expect(confirmButton.disabled).toBe(true);
  });

  it("offers the account's own real tags as chips alongside the suggestion", async () => {
    fetchActivityTagsMock.mockResolvedValue({ tags: ["pool pump"], colors: {} });
    renderActions([
      {
        type: "add_activity",
        label: "Add activity",
        date: "2026-08-20",
        start: "18:00",
        end: "19:00",
        suggestedTags: ["geyser"],
        requiresConfirmation: true
      }
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Add activity" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Pool Pump" })).not.toBeNull());
  });

  it("confirming posts the selected tags and shows success", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ activity: {} }) });
    vi.stubGlobal("fetch", fetchMock);

    renderActions([
      {
        type: "add_activity",
        label: "Add activity",
        date: "2026-08-20",
        start: "18:00",
        end: "19:00",
        suggestedTags: ["geyser"],
        requiresConfirmation: true
      }
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Add activity" }));
    fireEvent.click(screen.getByRole("button", { name: "Add activity" }));

    await waitFor(() => expect(screen.queryByText("Activity added.")).not.toBeNull());
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toMatchObject({ type: "add_activity", date: "2026-08-20", start: "18:00", end: "19:00", tags: ["geyser"] });
  });
});

describe("AssistantActionRow -- gating", () => {
  it("hides every mutating action for the demo account, but keeps navigate actions", () => {
    renderActions(
      [
        {
          type: "navigate",
          label: "View this day",
          destination: { page: "data", date: "2026-08-20", from: null, to: null }
        },
        { type: "sync", label: "Sync now", requiresConfirmation: true }
      ],
      { isDemo: true }
    );

    expect(screen.queryByRole("button", { name: "View day" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Sync now" })).toBeNull();
    expect(screen.queryByText("Demo account is read-only.")).not.toBeNull();
  });

  it("hides add_activity when Activities is disabled, and alert actions when Alerts is disabled", () => {
    renderActions(
      [
        {
          type: "add_activity",
          label: "Add activity",
          date: "2026-08-20",
          start: "18:00",
          end: "19:00",
          suggestedTags: [],
          requiresConfirmation: true
        },
        { type: "disable_alert", label: "Turn off", alertType: "low_balance", requiresConfirmation: true }
      ],
      { isActivitiesEnabled: false, isAlertsEnabled: false }
    );

    expect(screen.queryByRole("button", { name: "Add activity" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Turn off alert" })).toBeNull();
  });
});
