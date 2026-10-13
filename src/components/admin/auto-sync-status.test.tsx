// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AutoSyncStatus } from "./auto-sync-status";
const user = {
  autoSyncEnabled: true,
  connectionLifecycle: "active" as const,
  nextSyncAt: "2026-09-16T16:12:00Z",
  lastAutoSyncStatus: null
};
describe("effective admin auto-sync status", () => {
  afterEach(cleanup);
  it.each([
    ["paused", "Paused · inactivity"],
    ["cold", "Inactive · cold storage"],
    ["hibernating", "Inactive · cold-storage purge"],
    ["restoring", "Paused · restoring data"],
    ["restore_failed", "Inactive · restoration failed"]
  ] as const)("hides stale schedules for %s", (connectionLifecycle, label) => {
    render(<AutoSyncStatus user={{ ...user, connectionLifecycle }} />);
    expect(screen.getByText(label)).toBeTruthy();
    expect(screen.queryByText(/next/)).toBeNull();
  });
  it("preserves the schedule and failed-attempt detail for an active connection", () => {
    render(<AutoSyncStatus user={{ ...user, lastAutoSyncStatus: "failed" }} />);
    expect(screen.getByText(/On · next .* · last attempt failed/)).toBeTruthy();
  });
  it("preserves disabled and never-connected labels", () => {
    const { rerender } = render(<AutoSyncStatus user={{ ...user, autoSyncEnabled: false }} />);
    expect(screen.getByText("Off")).toBeTruthy();
    rerender(<AutoSyncStatus user={{ ...user, autoSyncEnabled: null }} />);
    expect(screen.getByText("No connection")).toBeTruthy();
  });
});
