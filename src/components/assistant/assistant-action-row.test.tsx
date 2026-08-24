// @vitest-environment jsdom
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import type { AssistantAction } from "@/lib/assistant/types";
import { AssistantActionRow } from "./assistant-action-row";
import { AssistantProvider } from "./assistant-provider";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock }) }));

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

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("AssistantActionRow", () => {
  it("navigate actions run immediately with no confirmation step", () => {
    renderActions([
      {
        type: "navigate",
        label: "View this day",
        destination: { page: "data", date: "2026-08-20", from: null, to: null }
      }
    ]);

    fireEvent.click(screen.getByRole("button", { name: "View this day" }));
    expect(pushMock).toHaveBeenCalledWith("/data?from=2026-08-20&to=2026-08-20");
  });

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

    fireEvent.click(screen.getByRole("button", { name: "Set R50 daily-spend alert" }));
    const input = screen.getByDisplayValue("50");
    fireEvent.change(input, { target: { value: "70" } });
    fireEvent.click(screen.getByRole("button", { name: "Set alert" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toMatchObject({ type: "set_alert", alertType: "daily_spend", threshold: 70 });
  });

  it("add_activity requires at least one tag before Add activity is enabled", () => {
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
    // The trigger button is replaced by the confirmation card (not
    // co-rendered), so there's exactly one "Add activity" button now: the
    // card's own confirm button.
    const confirmButton = screen.getByRole("button", { name: "Add activity" }) as HTMLButtonElement;
    expect(confirmButton.disabled).toBe(true);
  });

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

    expect(screen.queryByRole("button", { name: "View this day" })).not.toBeNull();
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
    expect(screen.queryByRole("button", { name: "Turn off" })).toBeNull();
  });
});
