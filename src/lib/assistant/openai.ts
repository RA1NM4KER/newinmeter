import OpenAI from "openai";
import { getOpenAiApiKey, getOpenAiModel, getOpenAiReasoningEffort } from "@/lib/env";
import { buildAssistantSystemPrompt } from "./system-prompt";
import { AssistantResponseJsonSchema, fallbackAssistantResponse, validateAssistantResponse } from "./response-schema";
import { createAssistantToolbox } from "./tools/index";
import type {
  AssistantContext,
  AssistantConversationMessage,
  AssistantPermissions,
  AssistantResponse,
  AssistantScope,
  ResponsesFunctionToolDefinition
} from "./types";

// The one tool the model must call to finish a turn. Registered alongside
// the read tools (see createAssistantToolbox) but handled entirely in this
// module, not the toolbox -- it has no DashboardContext dependency, and
// executing it is "validate and return", never a real handler call.
const SUBMIT_RESPONSE_TOOL_NAME = "submit_response";

// One extra iteration of headroom over the old 6 (Chat Completions, no
// forced final-answer tool): a turn can now spend one iteration on
// read-tool calls AND still need a separate iteration for submit_response,
// plus the identical loop must also tolerate one invalid-arguments retry
// before giving up.
const MAX_ITERATIONS = 8;

// The Responses API rejects `reasoning.effort` outright (400) for a model
// that isn't a reasoning model -- verified directly against the live API
// with gpt-4.1-mini, which is a real, currently-configured OPENAI_MODEL
// value in this project's own .env.local. Since OPENAI_MODEL is an
// operator-set override (see env.ts), the assistant must degrade
// gracefully rather than hard-failing every request when it points at a
// non-reasoning model -- this is a conservative allowlist-by-pattern, not
// an exhaustive model registry: o-series (o1, o3, o4, ...) and gpt-5+ are
// reasoning models; gpt-4.x and earlier are not.
export function modelSupportsReasoningEffort(model: string): boolean {
  return /^o\d/.test(model) || /^gpt-([5-9]\b|[1-9]\d)/.test(model);
}

function getClient(): OpenAI {
  const apiKey = getOpenAiApiKey();

  if (!apiKey) {
    throw new Error("Missing OPENAI_API_KEY for assistant access.");
  }

  return new OpenAI({ apiKey });
}

const submitResponseTool: ResponsesFunctionToolDefinition = {
  type: "function",
  name: SUBMIT_RESPONSE_TOOL_NAME,
  description:
    "Call this exactly once, as your final step, to submit your complete structured answer (answer, evidence, visualizations, actions, suggestions, scope). Never reply with plain assistant text instead of calling this.",
  parameters: AssistantResponseJsonSchema,
  strict: true
};

type ParsedJson = { ok: true; value: unknown } | { ok: false };

// Model-generated arguments (for any tool, including submit_response) are
// untrusted input -- malformed JSON must degrade to a structured retry
// signal, never an unhandled throw.
function parseJsonArguments(raw: string): ParsedJson {
  if (!raw) {
    return { ok: true, value: {} };
  }
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false };
  }
}

type ToolCallOutcome = { callId: string; toolName: string; payload: unknown; used: boolean };

async function runToolCall(
  toolbox: ReturnType<typeof createAssistantToolbox>,
  call: OpenAI.Responses.ResponseFunctionToolCall
): Promise<ToolCallOutcome> {
  const parsed = parseJsonArguments(call.arguments);
  const args =
    parsed.ok && typeof parsed.value === "object" && parsed.value !== null && !Array.isArray(parsed.value)
      ? (parsed.value as Record<string, unknown>)
      : null;

  if (args === null) {
    return {
      callId: call.call_id,
      toolName: call.name,
      payload: { error: "invalid_tool_arguments", tool: call.name },
      used: false
    };
  }

  try {
    const payload = await toolbox.execute(call.name, args);
    return { callId: call.call_id, toolName: call.name, payload, used: true };
  } catch (error) {
    const isUnknownTool = error instanceof Error && error.message.startsWith("Unknown assistant tool");
    return {
      callId: call.call_id,
      toolName: call.name,
      payload: { error: isUnknownTool ? "unknown_tool" : "tool_execution_failed", tool: call.name },
      used: false
    };
  }
}

function functionCallOutput(callId: string, payload: unknown): OpenAI.Responses.ResponseInputItem.FunctionCallOutput {
  return { type: "function_call_output", call_id: callId, output: JSON.stringify(payload) };
}

export async function answerAssistantQuestion(
  accessToken: string,
  userId: string,
  question: string,
  scope: AssistantScope,
  history: AssistantConversationMessage[] = [],
  permissions: AssistantPermissions = { activitiesEnabled: false, alertsEnabled: false },
  assistantContext: AssistantContext = {}
): Promise<AssistantResponse> {
  const client = getClient();
  const model = getOpenAiModel();
  const reasoningEffort = getOpenAiReasoningEffort();
  const toolbox = createAssistantToolbox(accessToken, userId, scope, permissions);
  const resolvedScope = { from: scope.from ?? "", to: scope.to ?? "" };

  const input: OpenAI.Responses.ResponseInputItem[] = [
    { role: "system", content: buildAssistantSystemPrompt(scope, permissions, assistantContext) },
    ...history.map(
      (message) => ({ role: message.role, content: message.content }) as OpenAI.Responses.ResponseInputItem
    ),
    { role: "user", content: question.trim() }
  ];

  const tools = [...toolbox.tools, submitResponseTool] as unknown as OpenAI.Responses.Tool[];
  const toolsUsed = new Set<string>();
  const includeReasoning = reasoningEffort !== "none" && modelSupportsReasoningEffort(model);

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration += 1) {
    const response = await client.responses.create({
      model,
      ...(includeReasoning ? { reasoning: { effort: reasoningEffort } } : {}),
      store: false,
      tools,
      tool_choice: "auto",
      // Never expose chain-of-thought to the client -- only the model's own
      // final text/tool-call output is ever read from `response` below;
      // reasoning content is neither requested via `include` nor forwarded
      // anywhere in this function's return value.
      input
    });

    const functionCalls = response.output.filter(
      (item): item is OpenAI.Responses.ResponseFunctionToolCall => item.type === "function_call"
    );

    if (functionCalls.length === 0) {
      // Model answered in plain text instead of calling submit_response --
      // fail gracefully into a minimal, still-valid structured response
      // rather than surfacing raw model prose as if it were the real
      // contract (spec: "fail gracefully rather than rendering random
      // model JSON").
      console.warn("assistant_skipped_structured_response", { model, iteration });
      const headline =
        response.output_text?.trim().slice(0, 200) || "I couldn't find a clear answer for that -- could you rephrase?";
      return { ...fallbackAssistantResponse(headline, resolvedScope), toolsUsed: Array.from(toolsUsed) };
    }

    // Echo this turn's full output back into input before appending tool
    // results. This call is intentionally stateless (store: false, no
    // previous_response_id) so every prior turn's output must be resent
    // verbatim for the model to see its own history -- Responses API output
    // items round-trip directly as input items by design.
    input.push(...(response.output as unknown as OpenAI.Responses.ResponseInputItem[]));

    const submitCall = functionCalls.find((call) => call.name === SUBMIT_RESPONSE_TOOL_NAME);

    if (submitCall) {
      const parsed = parseJsonArguments(submitCall.arguments);
      const validation = parsed.ok ? validateAssistantResponse(parsed.value) : null;

      if (validation?.ok) {
        return { ...validation.value, toolsUsed: Array.from(toolsUsed) };
      }

      const isLastIteration = iteration === MAX_ITERATIONS - 1;
      const issues = !parsed.ok
        ? ["arguments were not valid JSON"]
        : validation && !validation.ok
          ? validation.issues
          : [];

      if (isLastIteration) {
        console.error("assistant_structured_response_invalid", issues);
        return {
          ...fallbackAssistantResponse(
            "I couldn't put together a complete answer for that -- could you rephrase?",
            resolvedScope
          ),
          toolsUsed: Array.from(toolsUsed)
        };
      }

      // One retry: tell the model exactly what was wrong so it can fix and
      // resubmit, instead of silently discarding the turn.
      input.push(functionCallOutput(submitCall.call_id, { error: "invalid_response_shape", issues }));

      // Any other tool calls bundled into the same turn as submit_response
      // still need a matching function_call_output before the next
      // request, or the API rejects the whole turn.
      const otherCalls = functionCalls.filter((call) => call.name !== SUBMIT_RESPONSE_TOOL_NAME);
      const outcomes = await Promise.all(otherCalls.map((call) => runToolCall(toolbox, call)));
      for (const outcome of outcomes) {
        if (outcome.used) {
          toolsUsed.add(outcome.toolName);
        }
        input.push(functionCallOutput(outcome.callId, outcome.payload));
      }
      continue;
    }

    // Ordinary read-tool calls -- independent, side-effect-free reads over
    // one memoized DashboardContext, safe to run concurrently (see
    // tools/index.ts's getContext()).
    const outcomes = await Promise.all(functionCalls.map((call) => runToolCall(toolbox, call)));
    for (const outcome of outcomes) {
      if (outcome.used) {
        toolsUsed.add(outcome.toolName);
      }
      input.push(functionCallOutput(outcome.callId, outcome.payload));
    }
  }

  throw new Error("Assistant exceeded the maximum tool-call loop.");
}
