import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getCronSecret: vi.fn(), execute: vi.fn() }));
vi.mock("@/lib/env", () => ({ getCronSecret: mocks.getCronSecret }));
vi.mock("@/lib/diagnostics/canary-job", () => ({ executeDailyCanary: mocks.execute }));

import { POST } from "./route";

describe("POST /api/cron/livemopay-canary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCronSecret.mockReturnValue("cron-secret");
  });

  it("rejects requests without the cron bearer secret", async () => {
    const response = await POST(new Request("http://localhost/api/cron/livemopay-canary", { method: "POST" }));
    expect(response.status).toBe(401);
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("returns 503 for a final critical contract failure", async () => {
    mocks.execute.mockResolvedValue({ status: "critical", attempts: 2, failedStep: "ledger" });
    const response = await POST(
      new Request("http://localhost/api/cron/livemopay-canary", {
        method: "POST",
        headers: { authorization: "Bearer cron-secret" }
      })
    );
    expect(response.status).toBe(503);
  });
});
