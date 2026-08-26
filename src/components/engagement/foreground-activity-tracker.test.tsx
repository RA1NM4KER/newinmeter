// @vitest-environment jsdom

import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/lib/supabase/browser-client", () => ({
  createSupabaseBrowserClient: () => ({ rpc: mocks.rpc })
}));

import { FOREGROUND_ACTIVITY_THROTTLE_MS, ForegroundActivityTracker } from "./foreground-activity-tracker";

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", { configurable: true, value: state });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("ForegroundActivityTracker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    mocks.rpc.mockResolvedValue({ error: null });
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    vi.spyOn(Date, "now").mockReturnValue(1_000_000);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("records a visible authenticated app load and throttles remounts", async () => {
    const first = render(<ForegroundActivityTracker userId="user-a" />);
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith("record_user_activity"));

    first.unmount();
    render(<ForegroundActivityTracker userId="user-a" />);

    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it("does not count a hidden app until it returns to the foreground", async () => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    render(<ForegroundActivityTracker userId="user-a" />);
    expect(mocks.rpc).not.toHaveBeenCalled();

    setVisibility("visible");
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(1));
  });

  it("updates last-seen after meaningful later foreground use without creating interaction events", async () => {
    render(<ForegroundActivityTracker userId="user-a" />);
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(1));

    setVisibility("hidden");
    vi.mocked(Date.now).mockReturnValue(1_000_000 + FOREGROUND_ACTIVITY_THROTTLE_MS + 1);
    setVisibility("visible");

    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(2));
  });

  it("clears the throttle after a failed write so a later foreground event can retry", async () => {
    mocks.rpc.mockResolvedValueOnce({ error: { message: "unavailable" } }).mockResolvedValueOnce({ error: null });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    render(<ForegroundActivityTracker userId="user-a" />);
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(1));

    setVisibility("hidden");
    setVisibility("visible");

    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(2));
    expect(warn).toHaveBeenCalledWith("newinmeter_foreground_activity_failed");
  });
});
