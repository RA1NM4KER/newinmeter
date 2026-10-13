// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AdminUserListItem } from "@/lib/user-roles";
import { ConnectionStatusBadge } from "./connection-status-badge";
import { LifecycleIcon } from "./lifecycle-icon";
import { LastSyncCell } from "./last-sync-cell";

describe("admin lifecycle indicators", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });
  it.each([
    ["active", "Active"],
    ["paused", "Paused"],
    ["cold", "Cold / purged"]
  ] as const)("shows %s in the lifecycle indicator", (lifecycle, label) => {
    render(<LifecycleIcon lifecycle={lifecycle} />);
    expect(screen.getByRole("img", { name: label })).toBeTruthy();
  });
  it("preserves the original LiveMopay status dot", () => {
    render(<ConnectionStatusBadge status="connected" />);
    expect(screen.getByText("Connected")).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
  });
  it("shows historical sync with a snowflake and no extra purge text", () => {
    render(
      <LastSyncCell
        user={
          {
            lastRunStatus: "success",
            lastRunAt: "2026-09-16T10:15:04Z",
            connectionLifecycle: "cold"
          } as AdminUserListItem
        }
      />
    );
    expect(screen.getByText(/Synced/)).toBeTruthy();
    expect(screen.getByRole("img", { name: "Cold / purged" })).toBeTruthy();
    expect(screen.queryByText(/data purged/)).toBeNull();
    expect(screen.queryByText("No sync yet")).toBeNull();
  });
  it("shows exact SAST time alongside elapsed time with the full date discoverable", () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-13T19:00:00Z"));
    render(
      <LastSyncCell
        user={
          {
            lastRunStatus: "success",
            lastRunAt: "2026-10-13T18:19:00Z",
            connectionLifecycle: "active"
          } as AdminUserListItem
        }
        showExactTime
      />
    );
    expect(screen.getByText("Synced · 41m ago · 20:19").getAttribute("title")).toBe("13 Oct 2026, 20:19 SAST");
  });
  it("keeps the table label relative-only by default", () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-13T19:00:00Z"));
    render(
      <LastSyncCell
        user={
          {
            lastRunStatus: "success",
            lastRunAt: "2026-10-13T18:19:00Z",
            connectionLifecycle: "active"
          } as AdminUserListItem
        }
      />
    );
    expect(screen.getByText("Synced · 41m ago").getAttribute("title")).toBeNull();
    expect(screen.queryByText(/20:19/)).toBeNull();
  });
  it("retains the never-synced label without a known timestamp", () => {
    render(
      <LastSyncCell
        user={{ lastRunStatus: null, lastRunAt: null, connectionLifecycle: "active" } as AdminUserListItem}
      />
    );
    expect(screen.getByText("No sync yet")).toBeTruthy();
  });
});
