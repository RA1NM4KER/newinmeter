// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  refresh: vi.fn(),
  trackFunnelEvent: vi.fn()
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace, refresh: mocks.refresh })
}));
vi.mock("@/lib/funnel-client", () => ({ trackFunnelEvent: mocks.trackFunnelEvent }));

import { ConnectForm } from "./connect-form";

const PORTAL_URL = "https://app.livewalletportal.co.za";

function renderForm() {
  return render(
    <ConnectForm initialPendingAccounts={null} livemopayPortalUrl={PORTAL_URL} />
  );
}

function fillCredentials(email: string, password: string) {
  fireEvent.change(screen.getByPlaceholderText("Email you use on LiveMopay"), { target: { value: email } });
  fireEvent.change(screen.getByPlaceholderText("LiveMopay password"), { target: { value: password } });
}

describe("ConnectForm", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("explains these are the resident's existing LiveMopay details, not a new account", () => {
    renderForm();
    expect(screen.getByText(/same email and password you already use for LiveMopay/i)).toBeDefined();
  });

  it("shows a forgot-password link to the real LiveMopay portal, before and after an invalid-credentials error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ message: "That LiveMopay email or password isn't right.", invalidCredentials: true })
      })
    );
    renderForm();
    expect(screen.getByText(/forgot your livemopay password/i).closest("a")?.getAttribute("href")).toBe(PORTAL_URL);

    fillCredentials("resident@example.com", "wrong-password");
    fireEvent.click(screen.getByText("Connect"));

    const link = (await screen.findByText(/forgot your livemopay password/i)).closest("a");
    expect(link?.getAttribute("href")).toBe(PORTAL_URL);
  });

  it("shows only one forgot-password link for a generic/server failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ message: "Could not connect your LiveMopay account." })
      })
    );
    renderForm();

    fillCredentials("resident@example.com", "x");
    fireEvent.click(screen.getByText("Connect"));

    expect(await screen.findByText("Could not connect your LiveMopay account.")).toBeDefined();
    expect(screen.getAllByText(/forgot your livemopay password/i)).toHaveLength(1);
  });

  it("toggles password visibility", () => {
    renderForm();
    const input = screen.getByPlaceholderText("LiveMopay password") as HTMLInputElement;
    expect(input.type).toBe("password");
    fireEvent.click(screen.getByLabelText("Show password"));
    expect(input.type).toBe("text");
    fireEvent.click(screen.getByLabelText("Hide password"));
    expect(input.type).toBe("password");
  });

  it("counts the connect screen view once per browser session", () => {
    window.sessionStorage.clear();
    renderForm();
    renderForm();
    const views = mocks.trackFunnelEvent.mock.calls.filter(([event]) => event === "connect_screen_viewed");
    expect(views).toHaveLength(1);
  });

  it("tracks initial_sync_succeeded and navigates home after a successful connect + sync", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: "connected", accountLabel: "Home" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);

    renderForm();
    fillCredentials("resident@example.com", "correct-password");
    fireEvent.click(screen.getByText("Connect"));

    await waitFor(() => expect(mocks.trackFunnelEvent).toHaveBeenCalledWith("initial_sync_succeeded"));
    expect(mocks.replace).toHaveBeenCalledWith("/");
  });

  it("tracks initial_sync_failed and shows a retry option when the first sync fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: "connected", accountLabel: "Home" }) })
      .mockResolvedValueOnce({ ok: false, json: async () => ({ message: "Could not fetch your LiveMopay history." }) });
    vi.stubGlobal("fetch", fetchMock);

    renderForm();
    fillCredentials("resident@example.com", "correct-password");
    fireEvent.click(screen.getByText("Connect"));

    await waitFor(() => expect(mocks.trackFunnelEvent).toHaveBeenCalledWith("initial_sync_failed"));
    expect(await screen.findByText("Try again")).toBeDefined();
  });
});
