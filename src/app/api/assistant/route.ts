import type { AssistantConversationMessage, AssistantProgressStage, AssistantStreamEvent } from "@/lib/assistant/types";
import { NextResponse } from "next/server";
import { z } from "zod";
import { answerAssistantQuestion } from "@/lib/assistant/openai";
import { requireConnectedSession } from "@/lib/auth/session";
import { hasFeatureAccess } from "@/lib/features";
import { enforceRateLimit, getRateLimitIdentifier, rateLimitHeaders } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const requestSchema = z.object({
  question: z.string().trim().min(1, "Question is required."),
  from: z.string().optional(),
  to: z.string().optional(),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().trim().min(1)
      })
    )
    .max(12)
    .optional(),
  // Trusted, typed UI context -- e.g. the alertEventId behind "Ask AI" on a
  // notification. Never free text; ownership is verified server-side inside
  // explain_alert's own tool handler, not here.
  context: z
    .object({
      alertEventId: z.string().trim().min(1).max(200).optional()
    })
    .optional()
});

const encoder = new TextEncoder();

// SSE framing (`data: <json>\n\n`) over a plain fetch()'d ReadableStream --
// not a real EventSource (which can't send a POST body/custom headers), but
// the assistant-provider client parses this exact frame format itself. Every
// event is app-owned JSON (see AssistantStreamEvent): a raw tool name,
// function argument, or chain-of-thought fragment is never serialized here.
function sseFrame(event: AssistantStreamEvent): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
}

export async function POST(request: Request) {
  const auth = await requireConnectedSession();
  if (!auth.ok) {
    return NextResponse.json(
      { message: auth.status === 401 ? "Authentication required." : "Connect a LiveMopay account first." },
      { status: auth.status }
    );
  }

  const [aiAssistantEnabled, activitiesEnabled, alertsEnabled] = await Promise.all([
    hasFeatureAccess(auth.session.userId, "ai"),
    hasFeatureAccess(auth.session.userId, "activities"),
    hasFeatureAccess(auth.session.userId, "alerts")
  ]);
  if (!aiAssistantEnabled) {
    return NextResponse.json({ message: "The energy assistant is disabled for your account." }, { status: 403 });
  }

  const identifier = getRateLimitIdentifier(auth.session.userId, "assistant");
  const rateLimit = await enforceRateLimit(identifier, "assistant");
  const rateHeaders = rateLimitHeaders(rateLimit);

  if (!rateLimit.allowed) {
    return NextResponse.json(
      { message: "Rate limit exceeded. Please try again later." },
      { status: 429, headers: rateHeaders }
    );
  }

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ message: "Invalid request." }, { status: 400, headers: rateHeaders });
  }
  const body = parsed.data;

  // Everything above stays a normal, synchronously-checked JSON error
  // response (auth/feature-gate/rate-limit/validation) -- streaming only
  // starts once the request is fully accepted, so the client's existing
  // non-2xx handling for those cases needs no changes.
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      function send(event: AssistantStreamEvent) {
        if (closed) return;
        try {
          controller.enqueue(sseFrame(event));
        } catch {
          closed = true;
        }
      }

      send({ type: "started" });

      try {
        const result = await answerAssistantQuestion(
          auth.session.accessToken,
          auth.session.userId,
          body.question,
          { from: body.from, to: body.to },
          (body.history ?? []) as AssistantConversationMessage[],
          { activitiesEnabled, alertsEnabled },
          { alertEventId: body.context?.alertEventId },
          (stage: AssistantProgressStage, label: string) => send({ type: "progress", stage, label }),
          request.signal
        );
        send({ type: "response", response: result });
      } catch (error) {
        if (request.signal.aborted) {
          console.warn("assistant_request_aborted", { userId: auth.session.userId });
        } else {
          const message = error instanceof Error ? error.message : "Failed to answer assistant question.";
          console.error("newinmeter_assistant_failed", message);
          send({ type: "error", message: "Failed to answer assistant question." });
        }
      } finally {
        closed = true;
        try {
          controller.close();
        } catch {
          // Already closed (e.g. the client disconnected) -- nothing left
          // to clean up.
        }
      }
    },
    cancel() {
      // Client disconnected (dialog closed/unmounted) -- request.signal is
      // already tied to the underlying request and will have fired,
      // propagating into the in-flight OpenAI call above.
    }
  });

  return new Response(stream, {
    headers: {
      ...rateHeaders,
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive"
    }
  });
}
