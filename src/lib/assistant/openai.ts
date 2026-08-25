import OpenAI from "openai";
import { getOpenAiApiKey, getOpenAiModel, getOpenAiReasoningEffort } from "@/lib/env";
import { buildAssistantSystemPrompt } from "./system-prompt";
import { AssistantResponseJsonSchema, fallbackAssistantResponse, validateAssistantResponse } from "./response-schema";
import { validateSemanticRules } from "./semantic-validation";
import { checkDuplicateActivityProposals } from "./duplicate-activity-check";
import { progressForToolNames } from "./progress-labels";
import { createAssistantToolbox } from "./tools/index";
import type {
  AssistantContext,
  AssistantConversationMessage,
  AssistantPermissions,
  AssistantProgressStage,
  AssistantRequestTelemetry,
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

type ToolCallOutcome = { callId: string; toolName: string; payload: unknown; used: boolean; durationMs: number };

async function runToolCall(
  toolbox: ReturnType<typeof createAssistantToolbox>,
  call: OpenAI.Responses.ResponseFunctionToolCall
): Promise<ToolCallOutcome> {
  const startedAt = Date.now();
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
      used: false,
      durationMs: Date.now() - startedAt
    };
  }

  try {
    const payload = await toolbox.execute(call.name, args);
    return { callId: call.call_id, toolName: call.name, payload, used: true, durationMs: Date.now() - startedAt };
  } catch (error) {
    const isUnknownTool = error instanceof Error && error.message.startsWith("Unknown assistant tool");
    return {
      callId: call.call_id,
      toolName: call.name,
      payload: { error: isUnknownTool ? "unknown_tool" : "tool_execution_failed", tool: call.name },
      used: false,
      durationMs: Date.now() - startedAt
    };
  }
}

function functionCallOutput(callId: string, payload: unknown): OpenAI.Responses.ResponseInputItem.FunctionCallOutput {
  return { type: "function_call_output", call_id: callId, output: JSON.stringify(payload) };
}

type TelemetryState = AssistantRequestTelemetry & {
  startedAt: number;
  toolResults: Array<{ toolName: string; payload: unknown }>;
};

async function answerAssistantQuestionInternal(
  accessToken: string,
  userId: string,
  question: string,
  scope: AssistantScope,
  history: AssistantConversationMessage[] = [],
  permissions: AssistantPermissions = { activitiesEnabled: false, alertsEnabled: false },
  assistantContext: AssistantContext = {},
  // Fired right before a batch of real (non-submit_response) tool calls
  // executes -- see progress-labels.ts. Left undefined by every existing
  // caller/test (plain-promise callers are unaffected); /api/assistant
  // passes one to turn this into SSE progress frames. Never fired for
  // submit_response itself or for repair/retry bookkeeping -- only real
  // tool execution counts as progress.
  onProgress: ((stage: AssistantProgressStage, label: string) => void) | undefined,
  // Forwarded to every OpenAI request this turn issues, so a client
  // disconnect (dialog closed/unmounted mid-request) actually cancels the
  // in-flight upstream call instead of finishing pointlessly server-side.
  signal: AbortSignal | undefined,
  telemetry: TelemetryState
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

  // One repair attempt for "model replied in plain text instead of calling
  // submit_response" -- after that, a clean deterministic fallback is
  // returned with zero raw model prose (spec: never render output_text).
  let attemptedTextRepair = false;

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration += 1) {
    const modelStartedAt = Date.now();
    telemetry.modelRounds += 1;
    const response = await client.responses.create(
      {
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
      },
      signal ? { signal } : undefined
    );
    const modelElapsed = Date.now() - modelStartedAt;
    telemetry.modelDurationMs += modelElapsed;
    if (telemetry.timeToFirstOpenAiResponseMs === null) {
      telemetry.timeToFirstOpenAiResponseMs = Date.now() - telemetry.startedAt;
    }

    const functionCalls = response.output.filter(
      (item): item is OpenAI.Responses.ResponseFunctionToolCall => item.type === "function_call"
    );

    if (functionCalls.length === 0) {
      // Model answered in plain text instead of calling submit_response.
      // Raw output_text must NEVER reach the user (it bypasses every schema
      // and semantic guarantee this file otherwise enforces) -- attempt one
      // repair by explicitly instructing the model to call submit_response,
      // then fail into a clean deterministic message with zero model prose.
      console.warn("assistant_skipped_structured_response", { model, iteration, repaired: attemptedTextRepair });

      if (!attemptedTextRepair) {
        attemptedTextRepair = true;
        telemetry.skippedSubmitRepairs += 1;
        input.push(...(response.output as unknown as OpenAI.Responses.ResponseInputItem[]));
        input.push({
          role: "system",
          content:
            "You did not call the submit_response tool. You MUST call submit_response now with your complete structured answer -- do not reply with plain text."
        });
        continue;
      }

      return {
        ...fallbackAssistantResponse(
          "I couldn't format that answer properly. Please try that question again.",
          resolvedScope
        ),
        toolsUsed: Array.from(toolsUsed)
      };
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
      const structural = parsed.ok ? validateAssistantResponse(parsed.value) : null;

      // Semantic validation only runs once the response is structurally
      // valid -- it checks WORDING (false-completion claims, causation
      // overreach) and, via the async duplicate-activity check, real DB
      // state, neither of which is meaningful against a malformed payload.
      let semanticIssues: string[] = [];
      if (structural?.ok) {
        const wordingViolations = validateSemanticRules({
          response: structural.value,
          toolsUsed,
          question,
          trustedContext: assistantContext,
          toolResults: telemetry.toolResults
        });
        const duplicateViolations = await checkDuplicateActivityProposals(structural.value, accessToken);
        semanticIssues = [...wordingViolations, ...duplicateViolations].map(
          (violation) => `${violation.rule}: ${violation.detail}`
        );
      }

      if (structural?.ok && semanticIssues.length === 0) {
        telemetry.timeToFinalValidatedResponseMs = Date.now() - telemetry.startedAt;
        return { ...structural.value, toolsUsed: Array.from(toolsUsed) };
      }

      const isLastIteration = iteration === MAX_ITERATIONS - 1;
      const issues = !parsed.ok
        ? ["arguments were not valid JSON"]
        : structural && !structural.ok
          ? structural.issues
          : semanticIssues;

      if (isLastIteration) {
        console.error(
          structural?.ok ? "assistant_semantic_response_invalid" : "assistant_structured_response_invalid",
          issues
        );
        return {
          ...fallbackAssistantResponse(
            "I couldn't put together a complete answer for that -- could you rephrase?",
            resolvedScope
          ),
          toolsUsed: Array.from(toolsUsed)
        };
      }

      if (structural?.ok) telemetry.semanticRepairs += 1;
      else telemetry.structuredRepairs += 1;

      // One retry: tell the model exactly what was wrong (structural OR
      // semantic) so it can fix and resubmit, instead of silently
      // discarding the turn.
      input.push(functionCallOutput(submitCall.call_id, { error: "invalid_response_shape", issues }));

      // Any other tool calls bundled into the same turn as submit_response
      // still need a matching function_call_output before the next
      // request, or the API rejects the whole turn.
      const otherCalls = functionCalls.filter((call) => call.name !== SUBMIT_RESPONSE_TOOL_NAME);
      if (otherCalls.length > 0) {
        const progress = progressForToolNames(otherCalls.map((call) => call.name));
        if (progress) onProgress?.(progress.stage, progress.label);
      }
      const toolBatchStartedAt = Date.now();
      const outcomes = await Promise.all(otherCalls.map((call) => runToolCall(toolbox, call)));
      if (otherCalls.length > 0) {
        telemetry.toolExecutionBatches += 1;
        telemetry.toolDurationMs += Date.now() - toolBatchStartedAt;
      }
      for (const outcome of outcomes) {
        telemetry.perToolDurationMs[outcome.toolName] =
          (telemetry.perToolDurationMs[outcome.toolName] ?? 0) + outcome.durationMs;
        if (outcome.used) {
          toolsUsed.add(outcome.toolName);
          telemetry.toolResults.push({ toolName: outcome.toolName, payload: outcome.payload });
        }
        input.push(functionCallOutput(outcome.callId, outcome.payload));
      }
      continue;
    }

    // Ordinary read-tool calls -- independent, side-effect-free reads over
    // one memoized DashboardContext, safe to run concurrently (see
    // tools/index.ts's getContext()).
    const progress = progressForToolNames(functionCalls.map((call) => call.name));
    if (progress) onProgress?.(progress.stage, progress.label);
    const toolBatchStartedAt = Date.now();
    const outcomes = await Promise.all(functionCalls.map((call) => runToolCall(toolbox, call)));
    telemetry.toolExecutionBatches += 1;
    telemetry.toolDurationMs += Date.now() - toolBatchStartedAt;
    for (const outcome of outcomes) {
      telemetry.perToolDurationMs[outcome.toolName] =
        (telemetry.perToolDurationMs[outcome.toolName] ?? 0) + outcome.durationMs;
      if (outcome.used) {
        toolsUsed.add(outcome.toolName);
        telemetry.toolResults.push({ toolName: outcome.toolName, payload: outcome.payload });
      }
      input.push(functionCallOutput(outcome.callId, outcome.payload));
    }
  }

  throw new Error("Assistant exceeded the maximum tool-call loop.");
}

export async function answerAssistantQuestion(
  accessToken: string,
  userId: string,
  question: string,
  scope: AssistantScope,
  history: AssistantConversationMessage[] = [],
  permissions: AssistantPermissions = { activitiesEnabled: false, alertsEnabled: false },
  assistantContext: AssistantContext = {},
  onProgress?: (stage: AssistantProgressStage, label: string) => void,
  signal?: AbortSignal,
  onTelemetry?: (telemetry: AssistantRequestTelemetry) => void
): Promise<AssistantResponse> {
  const startedAt = Date.now();
  const telemetry: TelemetryState = {
    startedAt,
    durationMs: 0,
    timeToFirstOpenAiResponseMs: null,
    modelRounds: 0,
    modelDurationMs: 0,
    toolExecutionBatches: 0,
    toolDurationMs: 0,
    toolsUsed: [],
    perToolDurationMs: {},
    semanticRepairs: 0,
    structuredRepairs: 0,
    skippedSubmitRepairs: 0,
    timeToFinalValidatedResponseMs: null,
    aborted: false,
    model: getOpenAiModel(),
    reasoningEffort: getOpenAiReasoningEffort(),
    toolResults: []
  };
  try {
    return await answerAssistantQuestionInternal(
      accessToken,
      userId,
      question,
      scope,
      history,
      permissions,
      assistantContext,
      onProgress,
      signal,
      telemetry
    );
  } finally {
    telemetry.durationMs = Date.now() - startedAt;
    telemetry.aborted = signal?.aborted ?? false;
    telemetry.toolsUsed = Array.from(new Set(telemetry.toolResults.map((result) => result.toolName)));
    const { startedAt: _startedAt, toolResults: _toolResults, ...publicTelemetry } = telemetry;
    onTelemetry?.(publicTelemetry);
  }
}
