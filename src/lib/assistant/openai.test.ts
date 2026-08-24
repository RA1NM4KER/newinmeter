import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { answerAssistantQuestion, modelSupportsReasoningEffort } from "./openai";
import type { AssistantResponse, ResponsesFunctionToolDefinition } from "./types";

const { getOpenAiApiKeyMock, getOpenAiModelMock, getOpenAiReasoningEffortMock } = vi.hoisted(() => ({
  getOpenAiApiKeyMock: vi.fn(() => "test-key"),
  getOpenAiModelMock: vi.fn(() => "gpt-test"),
  getOpenAiReasoningEffortMock: vi.fn((): "none" | "minimal" | "low" | "medium" | "high" => "low")
}));

vi.mock("@/lib/env", () => ({
  getOpenAiApiKey: getOpenAiApiKeyMock,
  getOpenAiModel: getOpenAiModelMock,
  getOpenAiReasoningEffort: getOpenAiReasoningEffortMock
}));

const { createAssistantToolboxMock, executeMock } = vi.hoisted(() => ({
  createAssistantToolboxMock: vi.fn(),
  executeMock: vi.fn()
}));

vi.mock("./tools/index", () => ({
  createAssistantToolbox: createAssistantToolboxMock
}));

const { responsesCreateMock } = vi.hoisted(() => ({ responsesCreateMock: vi.fn() }));

vi.mock("openai", () => ({
  default: class MockOpenAI {
    responses = { create: responsesCreateMock };
  }
}));

const fakeToolDefinitions: ResponsesFunctionToolDefinition[] = [
  {
    type: "function",
    name: "tool_a",
    description: "Tool A",
    parameters: { type: "object", properties: {} },
    strict: true
  },
  {
    type: "function",
    name: "tool_b",
    description: "Tool B",
    parameters: { type: "object", properties: {} },
    strict: true
  }
];

function messageItem(text: string) {
  return {
    type: "message",
    role: "assistant",
    status: "completed",
    content: [{ type: "output_text", text, annotations: [] }]
  };
}

function functionCallItem(
  name: string,
  args: string,
  callId = `call-${name}-${Math.random().toString(36).slice(2, 8)}`
) {
  return { type: "function_call", call_id: callId, name, arguments: args, id: `item-${callId}` };
}

function toResponse(output: unknown[], outputText = "") {
  return { output, output_text: outputText };
}

function validSubmitArgs(overrides: Partial<Omit<AssistantResponse, "toolsUsed">> = {}) {
  return JSON.stringify({
    answer: "The answer is 42.",
    evidence: [],
    visualizations: [],
    actions: [],
    suggestions: [],
    scope: { from: "", to: "" },
    ...overrides
  });
}

function queueResponses(...bodies: ReturnType<typeof toResponse>[]) {
  for (const body of bodies) {
    responsesCreateMock.mockResolvedValueOnce(body);
  }
}

describe("modelSupportsReasoningEffort", () => {
  it("treats gpt-5+ and o-series models as reasoning-capable", () => {
    expect(modelSupportsReasoningEffort("gpt-5.6-terra")).toBe(true);
    expect(modelSupportsReasoningEffort("gpt-5")).toBe(true);
    expect(modelSupportsReasoningEffort("o1")).toBe(true);
    expect(modelSupportsReasoningEffort("o3-mini")).toBe(true);
  });

  it("treats gpt-4.x and earlier as not reasoning-capable -- verified against the live Responses API's own 400 for gpt-4.1-mini", () => {
    expect(modelSupportsReasoningEffort("gpt-4.1-mini")).toBe(false);
    expect(modelSupportsReasoningEffort("gpt-4o")).toBe(false);
    expect(modelSupportsReasoningEffort("gpt-3.5-turbo")).toBe(false);
  });
});

describe("answerAssistantQuestion", () => {
  beforeEach(() => {
    createAssistantToolboxMock.mockReset();
    executeMock.mockReset();
    responsesCreateMock.mockReset();
    getOpenAiModelMock.mockReturnValue("gpt-test");
    getOpenAiReasoningEffortMock.mockReturnValue("low");
    createAssistantToolboxMock.mockReturnValue({ tools: fakeToolDefinitions, execute: executeMock });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns the structured answer when the model calls submit_response directly", async () => {
    queueResponses(toResponse([functionCallItem("submit_response", validSubmitArgs())]));

    const result = await answerAssistantQuestion("token", "user-1", "What is the answer?", {});

    expect(result.answer).toBe("The answer is 42.");
    expect(result.toolsUsed).toEqual([]);
    expect(executeMock).not.toHaveBeenCalled();
  });

  it("passes accessToken, userId, scope, and permissions through to createAssistantToolbox", async () => {
    queueResponses(toResponse([functionCallItem("submit_response", validSubmitArgs())]));

    await answerAssistantQuestion("token", "user-1", "Q", { from: "2026-08-01", to: "2026-08-31" }, [], {
      activitiesEnabled: true,
      alertsEnabled: true
    });

    expect(createAssistantToolboxMock).toHaveBeenCalledWith(
      "token",
      "user-1",
      { from: "2026-08-01", to: "2026-08-31" },
      { activitiesEnabled: true, alertsEnabled: true }
    );
  });

  it("sends the model configured via getOpenAiModel and a reasoning.effort block matching getOpenAiReasoningEffort", async () => {
    getOpenAiModelMock.mockReturnValue("gpt-5.6-terra");
    getOpenAiReasoningEffortMock.mockReturnValue("medium");
    queueResponses(toResponse([functionCallItem("submit_response", validSubmitArgs())]));

    await answerAssistantQuestion("token", "user-1", "Q", {});

    const requestBody = responsesCreateMock.mock.calls[0][0];
    expect(requestBody.model).toBe("gpt-5.6-terra");
    expect(requestBody.reasoning).toEqual({ effort: "medium" });
    expect(requestBody.store).toBe(false);
  });

  it("omits the reasoning block entirely when reasoning effort is 'none'", async () => {
    getOpenAiReasoningEffortMock.mockReturnValue("none");
    queueResponses(toResponse([functionCallItem("submit_response", validSubmitArgs())]));

    await answerAssistantQuestion("token", "user-1", "Q", {});

    const requestBody = responsesCreateMock.mock.calls[0][0];
    expect(requestBody.reasoning).toBeUndefined();
  });

  it("omits the reasoning block for a non-reasoning model even when an effort is configured, since the Responses API rejects it outright for those models", async () => {
    getOpenAiModelMock.mockReturnValue("gpt-4.1-mini");
    getOpenAiReasoningEffortMock.mockReturnValue("low");
    queueResponses(toResponse([functionCallItem("submit_response", validSubmitArgs())]));

    await answerAssistantQuestion("token", "user-1", "Q", {});

    const requestBody = responsesCreateMock.mock.calls[0][0];
    expect(requestBody.reasoning).toBeUndefined();
  });

  it("registers submit_response alongside the toolbox's own tools, all strict", async () => {
    queueResponses(toResponse([functionCallItem("submit_response", validSubmitArgs())]));

    await answerAssistantQuestion("token", "user-1", "Q", {});

    const requestBody = responsesCreateMock.mock.calls[0][0];
    const names = requestBody.tools.map((tool: { name: string }) => tool.name);
    expect(names).toEqual(["tool_a", "tool_b", "submit_response"]);
    expect(requestBody.tools.every((tool: { strict: boolean }) => tool.strict === true)).toBe(true);
  });

  it("includes prior conversation history and the new question in the request input", async () => {
    queueResponses(toResponse([functionCallItem("submit_response", validSubmitArgs())]));

    await answerAssistantQuestion("token", "user-1", "Follow-up question", {}, [
      { role: "user", content: "First question" },
      { role: "assistant", content: "First answer" }
    ]);

    // The request `input` array is mutated in place after being sent (later
    // iterations append the model's own output/tool results to the same
    // array reference for the next turn -- see openai.ts), so `mock.calls`
    // reflects the array's FINAL state, not a snapshot at call time. This
    // still faithfully proves history + the new question were part of the
    // original request: nothing here removes earlier items, only appends.
    const requestBody = responsesCreateMock.mock.calls[0][0];
    const messages = requestBody.input.filter(
      (item: { role?: string; content?: string }) => typeof item.content === "string"
    );
    expect(messages).toContainEqual({ role: "user", content: "First question" });
    expect(messages).toContainEqual({ role: "assistant", content: "First answer" });
    expect(messages).toContainEqual({ role: "user", content: "Follow-up question" });
  });

  it("never forwards reasoning content in the returned AssistantResponse", async () => {
    queueResponses(
      toResponse([
        { type: "reasoning", id: "r1", summary: [{ type: "summary_text", text: "secret chain of thought" }] },
        functionCallItem("submit_response", validSubmitArgs({ answer: "Public answer only." }))
      ])
    );

    const result = await answerAssistantQuestion("token", "user-1", "Q", {});

    expect(JSON.stringify(result)).not.toContain("secret chain of thought");
    expect(result.answer).toBe("Public answer only.");
  });

  it("executes multiple read-tool calls from one turn and maps each result to its own call_id, then submits", async () => {
    queueResponses(
      toResponse([functionCallItem("tool_a", "{}", "call-a"), functionCallItem("tool_b", '{"x":1}', "call-b")]),
      toResponse([functionCallItem("submit_response", validSubmitArgs())])
    );
    executeMock.mockImplementation(async (name: string) => ({ from: name }));

    const result = await answerAssistantQuestion("token", "user-1", "Q", {});

    expect(result.toolsUsed.sort()).toEqual(["tool_a", "tool_b"]);
    expect(executeMock).toHaveBeenCalledWith("tool_a", {});
    expect(executeMock).toHaveBeenCalledWith("tool_b", { x: 1 });

    const secondRequestInput = responsesCreateMock.mock.calls[1][0].input;
    const outputs = secondRequestInput.filter((item: { type?: string }) => item.type === "function_call_output");
    expect(outputs).toHaveLength(2);
    expect(outputs.find((o: { call_id: string }) => o.call_id === "call-a")).toMatchObject({
      output: JSON.stringify({ from: "tool_a" })
    });
    expect(outputs.find((o: { call_id: string }) => o.call_id === "call-b")).toMatchObject({
      output: JSON.stringify({ from: "tool_b" })
    });
  });

  it("returns a structured error and skips execution for malformed tool arguments, instead of throwing", async () => {
    queueResponses(
      toResponse([functionCallItem("tool_a", "{not valid json", "call-a")]),
      toResponse([functionCallItem("submit_response", validSubmitArgs())])
    );

    const result = await answerAssistantQuestion("token", "user-1", "Q", {});

    expect(result.toolsUsed).toEqual([]);
    expect(executeMock).not.toHaveBeenCalled();

    const secondRequestInput = responsesCreateMock.mock.calls[1][0].input;
    const output = secondRequestInput.find((item: { type?: string }) => item.type === "function_call_output");
    expect(JSON.parse(output.output)).toEqual({ error: "invalid_tool_arguments", tool: "tool_a" });
  });

  it("returns a structured error for tool arguments that parse to a non-object (e.g. an array)", async () => {
    queueResponses(
      toResponse([functionCallItem("tool_a", "[1,2,3]", "call-a")]),
      toResponse([functionCallItem("submit_response", validSubmitArgs())])
    );

    await answerAssistantQuestion("token", "user-1", "Q", {});
    expect(executeMock).not.toHaveBeenCalled();
  });

  it("returns a structured unknown_tool error, without leaking internal error details, when the tool name isn't registered", async () => {
    queueResponses(
      toResponse([functionCallItem("bogus_tool", "{}", "call-a")]),
      toResponse([functionCallItem("submit_response", validSubmitArgs())])
    );
    executeMock.mockRejectedValueOnce(new Error("Unknown assistant tool: bogus_tool"));

    const result = await answerAssistantQuestion("token", "user-1", "Q", {});

    expect(result.toolsUsed).toEqual([]);
    const secondRequestInput = responsesCreateMock.mock.calls[1][0].input;
    const output = secondRequestInput.find((item: { type?: string }) => item.type === "function_call_output");
    expect(JSON.parse(output.output)).toEqual({ error: "unknown_tool", tool: "bogus_tool" });
  });

  it("returns a structured tool_execution_failed error, without leaking the underlying message, when a handler throws", async () => {
    queueResponses(
      toResponse([functionCallItem("tool_a", "{}", "call-a")]),
      toResponse([functionCallItem("submit_response", validSubmitArgs())])
    );
    executeMock.mockRejectedValueOnce(new Error("Supabase connection refused at 10.0.0.5"));

    await answerAssistantQuestion("token", "user-1", "Q", {});

    const secondRequestInput = responsesCreateMock.mock.calls[1][0].input;
    const output = secondRequestInput.find((item: { type?: string }) => item.type === "function_call_output");
    const payload = JSON.parse(output.output);
    expect(payload).toEqual({ error: "tool_execution_failed", tool: "tool_a" });
    expect(output.output).not.toContain("10.0.0.5");
  });

  it("excludes failed tool calls from toolsUsed while still including successful ones in the same turn", async () => {
    queueResponses(
      toResponse([functionCallItem("tool_a", "{}", "call-a"), functionCallItem("tool_b", "not json", "call-b")]),
      toResponse([functionCallItem("submit_response", validSubmitArgs())])
    );
    executeMock.mockResolvedValueOnce({ ok: true });

    const result = await answerAssistantQuestion("token", "user-1", "Q", {});
    expect(result.toolsUsed).toEqual(["tool_a"]);
  });

  it("retries once when submit_response's arguments fail schema validation, then returns the corrected structured answer", async () => {
    queueResponses(
      toResponse([functionCallItem("submit_response", JSON.stringify({ answer: "" }), "call-1")]),
      toResponse([functionCallItem("submit_response", validSubmitArgs({ answer: "Fixed answer." }), "call-2")])
    );

    const result = await answerAssistantQuestion("token", "user-1", "Q", {});

    expect(result.answer).toBe("Fixed answer.");
    const secondRequestInput = responsesCreateMock.mock.calls[1][0].input;
    const errorOutput = secondRequestInput.find(
      (item: { type?: string; call_id?: string }) => item.type === "function_call_output" && item.call_id === "call-1"
    );
    expect(JSON.parse(errorOutput.output).error).toBe("invalid_response_shape");
  });

  it("falls back to a minimal valid response, never throwing raw model JSON, when submit_response's arguments never validate", async () => {
    const bodies = Array.from({ length: 8 }, (_, index) =>
      toResponse([functionCallItem("submit_response", JSON.stringify({ answer: "" }), `call-${index}`)])
    );
    queueResponses(...bodies);

    const result = await answerAssistantQuestion("token", "user-1", "Q", {});

    expect(result.answer.length).toBeGreaterThan(0);
    expect(result.evidence).toEqual([]);
    expect(result.actions).toEqual([]);
  });

  it("falls back gracefully to plain output_text when the model answers without calling any tool", async () => {
    queueResponses(toResponse([messageItem("A plain-text answer.")], "A plain-text answer."));

    const result = await answerAssistantQuestion("token", "user-1", "Q", {});

    expect(result.answer).toBe("A plain-text answer.");
    expect(result.evidence).toEqual([]);
    expect(result.visualizations).toEqual([]);
    expect(result.actions).toEqual([]);
    expect(result.suggestions).toEqual([]);
  });

  it("throws once the maximum tool-call loop is exceeded without ever reaching submit_response", async () => {
    const bodies = Array.from({ length: 8 }, (_, index) =>
      toResponse([functionCallItem("tool_a", "{}", `call-${index}`)])
    );
    queueResponses(...bodies);
    executeMock.mockResolvedValue({ ok: true });

    await expect(answerAssistantQuestion("token", "user-1", "Q", {})).rejects.toThrow(
      "Assistant exceeded the maximum tool-call loop."
    );
  });

  it("passes a trusted alertEventId context through to the system prompt without echoing it into the user-visible answer contract", async () => {
    queueResponses(toResponse([functionCallItem("submit_response", validSubmitArgs())]));

    await answerAssistantQuestion("token", "user-1", "Q", {}, [], undefined, { alertEventId: "event-123" });

    const requestBody = responsesCreateMock.mock.calls[0][0];
    const systemMessage = requestBody.input[0];
    expect(systemMessage.content).toContain("event-123");
  });
});
