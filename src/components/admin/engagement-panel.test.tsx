// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { EngagementPanel } from "./engagement-panel";

describe("EngagementPanel", () => {
  afterEach(cleanup);

  it("shows compact human-activity and clearly labelled domain adoption metrics", () => {
    render(
      <EngagementPanel
        metrics={{
          totalRealUsers: 17,
          activeToday: 3,
          activeLast7Days: 9,
          activeLast30Days: 12,
          adoption: {
            activities: { users: 8, percentage: 47 },
            alertsEnabled: { users: 4, percentage: 24 },
            push: { users: 6, percentage: 35 },
            ai: { users: 2, percentage: 12 },
            livemopay: { users: 15, percentage: 88 }
          }
        }}
      />
    );

    expect(screen.getByText("Foreground app use only · SAST calendar days")).toBeTruthy();
    expect(screen.getByText("Alerts enabled")).toBeTruthy();
    expect(screen.getByText("8 / 17")).toBeTruthy();
    expect(screen.getByText("47%")).toBeTruthy();
    expect(screen.getByText(/no historical activity is inferred from sign-ins or syncs/i)).toBeTruthy();
  });
});
