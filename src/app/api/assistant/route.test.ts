import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireConnectedSession: vi.fn(),
  hasFeatureAccess: vi.fn(),
  enforceRateLimit: vi.fn(),
  answerAssistantQuestion: vi.fn()
}));

vi.mock("@/lib/auth/session", () => ({ requireConnectedSession: mocks.requireConnectedSession }));
vi.mock("@/lib/features", () => ({ hasFeatureAccess: mocks.hasFeatureAccess }));
vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: mocks.enforceRateLimit,
  getRateLimitIdentifier: (userId: string, scope: string) => `${userId}:${scope}`,
  rateLimitHeaders: () => ({})
}));
vi.mock("@/lib/assistant/openai", () => ({ answerAssistantQuestion: mocks.answerAssistantQuestion }));

import { POST } from "./route";

const session = { userId: "user-a", accessToken: "token", connection: { id: "conn-a" } };

function request(body: unknown) {
  return new Request("http://localhost/api/assistant", { method: "POST", body: JSON.stringify(body) });
}

const validAssistantResponse = {
  headline: "You used 12 kWh yesterday.",
  metrics: [],
  body: [],
  evidence: [],
  visualizations: [],
  actions: [],
  suggestions: [],
  scope: { from: "2026-08-01", to: "2026-08-20" },
  toolsUsed: ["get_scope_overview"]
};

describe("POST /api/assistant", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireConnectedSession.mockResolvedValue({ ok: true, session });
    mocks.hasFeatureAccess.mockResolvedValue(true);
    mocks.enforceRateLimit.mockResolvedValue({ allowed: true, minute: {}, day: {} });
    mocks.answerAssistantQuestion.mockResolvedValue(validAssistantResponse);
  });

  it("requires authentication", async () => {
    mocks.requireConnectedSession.mockResolvedValue({ ok: false, status: 401 });
    const response = await POST(request({ question: "Q" }));
    expect(response.status).toBe(401);
    expect(mocks.answerAssistantQuestion).not.toHaveBeenCalled();
  });

  it("returns 403 when the AI feature is off for this account, without ever calling the model", async () => {
    mocks.hasFeatureAccess.mockImplementation(async (_userId: string, key: string) => key !== "ai");
    const response = await POST(request({ question: "Q" }));
    expect(response.status).toBe(403);
    expect(mocks.answerAssistantQuestion).not.toHaveBeenCalled();
  });

  it("rejects an empty question with 400 before ever reaching the model", async () => {
    const response = await POST(request({ question: "" }));
    expect(response.status).toBe(400);
    expect(mocks.answerAssistantQuestion).not.toHaveBeenCalled();
  });

  it("returns 429 and never calls the model when the rate limit is exceeded", async () => {
    mocks.enforceRateLimit.mockResolvedValue({ allowed: false, minute: {}, day: {} });
    const response = await POST(request({ question: "Q" }));
    expect(response.status).toBe(429);
    expect(mocks.answerAssistantQuestion).not.toHaveBeenCalled();
  });

  it("passes the authenticated session's own userId/accessToken -- never anything from the request body", async () => {
    await POST(
      request({
        question: "Why was yesterday expensive?",
        from: "2026-08-01",
        to: "2026-08-20",
        userId: "someone-else"
      })
    );

    expect(mocks.answerAssistantQuestion).toHaveBeenCalledWith(
      "token",
      "user-a",
      "Why was yesterday expensive?",
      { from: "2026-08-01", to: "2026-08-20" },
      [],
      { activitiesEnabled: true, alertsEnabled: true },
      { alertEventId: undefined }
    );
  });

  it("resolves activitiesEnabled and alertsEnabled independently and threads both through to the model layer", async () => {
    mocks.hasFeatureAccess.mockImplementation(
      async (_userId: string, key: string) => key === "ai" || key === "activities"
    );
    await POST(request({ question: "Q" }));

    expect(mocks.answerAssistantQuestion).toHaveBeenCalledWith(
      "token",
      "user-a",
      "Q",
      {},
      [],
      { activitiesEnabled: true, alertsEnabled: false },
      { alertEventId: undefined }
    );
  });

  it("forwards a trusted alertEventId context field from the request body", async () => {
    await POST(request({ question: "Explain this alert.", context: { alertEventId: "event-123" } }));

    expect(mocks.answerAssistantQuestion).toHaveBeenCalledWith(
      "token",
      "user-a",
      "Explain this alert.",
      {},
      [],
      { activitiesEnabled: true, alertsEnabled: true },
      { alertEventId: "event-123" }
    );
  });

  it("returns the full structured AssistantResponse from the model layer, unmodified", async () => {
    const response = await POST(request({ question: "Q" }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(validAssistantResponse);
  });

  it("never leaks the underlying error message to the client on failure, only a generic one", async () => {
    mocks.answerAssistantQuestion.mockRejectedValue(new Error("OpenAI request failed: sk-secret-key-in-error"));
    const response = await POST(request({ question: "Q" }));

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.message).not.toContain("sk-secret-key-in-error");
  });

  it("caps conversation history at 12 messages via the request schema", async () => {
    const longHistory = Array.from({ length: 13 }, (_, index) => ({ role: "user", content: `msg ${index}` }));
    const response = await POST(request({ question: "Q", history: longHistory }));
    expect(response.status).toBe(400);
  });
});
