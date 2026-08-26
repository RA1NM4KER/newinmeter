import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ listAdminUserIds: vi.fn(), send: vi.fn() }));
vi.mock("../user-roles", () => ({ listAdminUserIds: mocks.listAdminUserIds }));
vi.mock("../push-notify", () => ({ sendPushToUserWithReport: mocks.send }));

import { operationalNotificationUrl, sendOperationalPushToAdmins } from "./notifications";

describe("operational admin notifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listAdminUserIds.mockResolvedValue(["admin-a", "admin-b"]);
    mocks.send.mockResolvedValue({ attempted: 1, delivered: 1, expiredRemoved: 0, hardFailures: 0 });
  });

  it("targets only user ids returned by the admin-role lookup", async () => {
    await sendOperationalPushToAdmins({ title: "System health", body: "Action required", tag: "system-health" });
    expect(mocks.send).toHaveBeenCalledTimes(2);
    expect(mocks.send).toHaveBeenCalledWith("admin-a", expect.any(Object));
    expect(mocks.send).toHaveBeenCalledWith("admin-b", expect.any(Object));
  });

  it("builds a safe Diagnostics deep link from internal identifiers", () => {
    expect(operationalNotificationUrl({ connectionId: "internal-connection", eventId: "internal-event" })).toBe(
      "/admin/diagnostics?connection=internal-connection&event=internal-event"
    );
  });

  it("continues targeting other admins when one admin push setup fails", async () => {
    mocks.send.mockRejectedValueOnce(new Error("missing subscription state")).mockResolvedValueOnce({
      attempted: 1,
      delivered: 1,
      expiredRemoved: 0,
      hardFailures: 0
    });

    const report = await sendOperationalPushToAdmins({ title: "System health", body: "Action required" });

    expect(mocks.send).toHaveBeenCalledTimes(2);
    expect(report).toEqual({ admins: 2, attempted: 1, delivered: 1, failed: 1 });
  });
});
