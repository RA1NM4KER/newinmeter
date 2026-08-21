import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  getSupabaseUrl: () => "https://project.supabase.co",
  getSupabaseServiceRoleKey: () => "service-role-secret"
}));

import { broadcastPulsesChanged } from "@/lib/live/broadcast";

describe("broadcastPulsesChanged", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true, status: 202 });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends exactly one broadcast to the owner's private topic with a minimal payload", async () => {
    await broadcastPulsesChanged("user-a", 5);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://project.supabase.co/realtime/v1/api/broadcast");

    const body = JSON.parse(init.body);
    expect(body.messages).toHaveLength(1);
    const message = body.messages[0];
    expect(message.topic).toBe("live-meter:user-a");
    expect(message.event).toBe("pulses_changed");
    expect(message.private).toBe(true);
    expect(message.payload).toMatchObject({ accepted: 5 });
    expect(typeof message.payload.at).toBe("string");
  });

  it("never leaks pulse rows, device secrets or credentials in the payload", async () => {
    await broadcastPulsesChanged("user-a", 3);
    const body = fetchMock.mock.calls[0][1].body as string;
    expect(body).not.toContain("api_key_hash");
    expect(body).not.toContain("nm_dev_");
    expect(body).not.toContain("delta_ms");
    // The service-role key is a request header, never the message body.
    expect(body).not.toContain("service-role-secret");
  });

  it("swallows a non-ok response without throwing (ingestion stays durable)", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    await expect(broadcastPulsesChanged("user-a", 2)).resolves.toBeUndefined();
  });

  it("swallows a network error without throwing", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    await expect(broadcastPulsesChanged("user-a", 2)).resolves.toBeUndefined();
  });
});
