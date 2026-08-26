// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./env", () => ({
  getSupabaseAnonKey: () => "anon-key",
  getSupabaseServiceRoleKey: () => "service-role-key",
  getSupabaseUrl: () => "https://example.supabase.co"
}));

import { adminSupabaseFetchAllPages } from "./supabase-rest";

describe("adminSupabaseFetchAllPages", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("reads every PostgREST page with the service role and explicit ranges", async () => {
    const firstPage = Array.from({ length: 1000 }, (_, index) => ({ id: index }));
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify(firstPage), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([{ id: 1000 }]), { status: 200 }));

    const rows = await adminSupabaseFetchAllPages<{ id: number }>("/example?select=id");

    expect(rows).toHaveLength(1001);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1].headers.Range).toBe("0-999");
    expect(fetchMock.mock.calls[1][1].headers.Range).toBe("1000-1999");
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer service-role-key");
  });
});
