// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { AdminUserListItem } from "@/lib/user-roles";
import { FeatureChips } from "./feature-chips";

function user(overrides: Partial<AdminUserListItem["features"]> = {}): AdminUserListItem {
  const rollout = { enabled: false, source: "rollout" as const };
  return {
    userId: "user-1",
    role: "user",
    email: "user@example.com",
    createdAt: "2026-01-01T00:00:00.000Z",
    features: { ai: rollout, activities: rollout, live: rollout, alerts: rollout, ...overrides },
    connectionStatus: null,
    lastRunStatus: null,
    lastRunAt: null,
    lastRunError: null,
    lastRunRowsSynced: null,
    autoSyncEnabled: null,
    nextSyncAt: null,
    lastAutoSyncStatus: null,
    lastAutoSyncAt: null
  };
}

describe("FeatureChips", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows 'None' when every feature is off", () => {
    render(<FeatureChips user={user()} />);
    expect(screen.getByText("None")).toBeDefined();
  });

  it("shows one chip per enabled feature, using the short label", () => {
    render(
      <FeatureChips
        user={user({
          ai: { enabled: true, source: "rollout" },
          alerts: { enabled: true, source: "override" }
        })}
      />
    );
    expect(screen.getByText("AI")).toBeDefined();
    expect(screen.getByText("Alerts")).toBeDefined();
    expect(screen.queryByText("Activities")).toBeNull();
    expect(screen.queryByText("None")).toBeNull();
  });
});
