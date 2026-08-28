import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ adminSupabaseRequest: vi.fn() }));

vi.mock("./supabase-rest", () => ({ adminSupabaseRequest: mocks.adminSupabaseRequest }));

import { recordFunnelEvent } from "./funnel";

describe("recordFunnelEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls the record_funnel_event RPC with the given event type", async () => {
    mocks.adminSupabaseRequest.mockResolvedValue(undefined);

    await recordFunnelEvent("login_page_viewed");

    expect(mocks.adminSupabaseRequest).toHaveBeenCalledWith(
      "POST",
      "/rpc/record_funnel_event",
      { p_event_type: "login_page_viewed" },
      "return=minimal"
    );
  });

  it("never throws when the RPC call fails -- tracking must never block onboarding", async () => {
    mocks.adminSupabaseRequest.mockRejectedValue(new Error("network down"));

    await expect(recordFunnelEvent("connect_attempted")).resolves.toBeUndefined();
  });
});
