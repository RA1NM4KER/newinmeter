import { describe, expect, it, vi } from "vitest";
import { buildTestContext } from "../test-fixtures";
import { getRecentAlertsTool } from "./get-recent-alerts";

const mocks = vi.hoisted(() => ({ getRecentNotifications: vi.fn() }));
vi.mock("@/lib/newinmeter/alerts", () => ({ getRecentNotifications: mocks.getRecentNotifications }));

describe("get_recent_alerts", () => {
  it("maps notification items to a lean alertEventId-keyed shape, defaulting the limit to 10", async () => {
    mocks.getRecentNotifications.mockResolvedValue([
      {
        id: "evt-1",
        type: "low_balance",
        title: "Low balance",
        body: "R150",
        url: "/",
        triggeredAt: "2026-08-20T10:00:00Z",
        readAt: null,
        isRead: false
      }
    ]);

    const context = buildTestContext([], [], { from: "", to: "" });
    const result = (await getRecentAlertsTool.handler({}, async () => context)) as {
      alerts: Array<{ alertEventId: string }>;
    };

    expect(mocks.getRecentNotifications).toHaveBeenCalledWith(context.userId, 10);
    expect(result.alerts).toEqual([
      {
        alertEventId: "evt-1",
        type: "low_balance",
        title: "Low balance",
        body: "R150",
        triggeredAt: "2026-08-20T10:00:00Z",
        isRead: false
      }
    ]);
  });

  it("clamps a requested limit to the 1-30 range", async () => {
    mocks.getRecentNotifications.mockResolvedValue([]);
    const context = buildTestContext([], [], { from: "", to: "" });

    await getRecentAlertsTool.handler({ limit: 999 }, async () => context);
    expect(mocks.getRecentNotifications).toHaveBeenCalledWith(context.userId, 30);

    await getRecentAlertsTool.handler({ limit: 0 }, async () => context);
    expect(mocks.getRecentNotifications).toHaveBeenCalledWith(context.userId, 1);
  });

  it("never surfaces a userId argument from client input -- it always comes from context", async () => {
    mocks.getRecentNotifications.mockResolvedValue([]);
    const context = buildTestContext([], [], { from: "", to: "" }, { userId: "the-real-user" });

    await getRecentAlertsTool.handler({ userId: "attacker-supplied" }, async () => context);
    expect(mocks.getRecentNotifications).toHaveBeenCalledWith("the-real-user", 10);
  });
});
