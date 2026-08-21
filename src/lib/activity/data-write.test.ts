import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticatedSupabaseFetch: vi.fn()
}));

vi.mock("@/lib/supabase-rest", () => ({
  authenticatedSupabaseFetch: mocks.authenticatedSupabaseFetch,
  authenticatedSupabaseFetchAllPages: vi.fn()
}));

import { updateActivity } from "./data";

const crossMidnightRow = {
  id: "activity-a",
  connection_id: "connection-a",
  starts_at: "2026-08-16T22:00:00",
  ends_at: "2026-08-17T05:00:00",
  all_day: false,
  tags: ["heater"],
  color: "#0f766e",
  note: null,
  created_at: "2026-08-16T20:00:00Z",
  updated_at: "2026-08-16T20:00:00Z"
};

describe("activity writes", () => {
  beforeEach(() => {
    mocks.authenticatedSupabaseFetch.mockReset();
  });

  it("preserves a cross-midnight end date when an existing activity is resaved", async () => {
    mocks.authenticatedSupabaseFetch
      .mockResolvedValueOnce([crossMidnightRow])
      .mockResolvedValueOnce([crossMidnightRow]);

    await updateActivity("access-token", "connection-a", "activity-a", {});

    expect(mocks.authenticatedSupabaseFetch).toHaveBeenLastCalledWith(
      "/usage_activities?id=eq.activity-a",
      "access-token",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({
          connection_id: "connection-a",
          starts_at: "2026-08-16T22:00:00",
          ends_at: "2026-08-17T05:00:00",
          all_day: false,
          tags: ["heater"],
          color: "#0f766e",
          note: null
        })
      })
    );
  });
});
