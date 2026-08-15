import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticatedSupabaseFetch: vi.fn(),
  authenticatedSupabaseResponse: vi.fn()
}));

vi.mock("@/lib/supabase-rest", () => ({
  authenticatedSupabaseFetch: mocks.authenticatedSupabaseFetch,
  authenticatedSupabaseFetchAllPages: vi.fn(),
  authenticatedSupabaseResponse: mocks.authenticatedSupabaseResponse
}));

import { loadEnergyRowsPage } from "@/lib/energy-data";

describe("loadEnergyRowsPage", () => {
  beforeEach(() => {
    mocks.authenticatedSupabaseFetch.mockReset();
    mocks.authenticatedSupabaseResponse.mockReset();
    mocks.authenticatedSupabaseFetch.mockResolvedValue([]);
    mocks.authenticatedSupabaseResponse.mockResolvedValue(
      new Response(JSON.stringify([]), {
        headers: { "Content-Range": "0-49/12669" }
      })
    );
  });

  it("requests an exact total so pagination never relies on a planner estimate", async () => {
    const result = await loadEnergyRowsPage("access-token", {
      chargeType: "energy",
      from: "2025-11-24",
      to: "2026-08-15"
    });

    expect(mocks.authenticatedSupabaseResponse).toHaveBeenCalledWith(
      expect.stringContaining("charge_label=like.Energy+Charge%3A*"),
      "access-token",
      {
        headers: {
          Prefer: "count=exact",
          Range: "0-49"
        }
      }
    );
    expect(result.total).toBe(12669);
  });
});
