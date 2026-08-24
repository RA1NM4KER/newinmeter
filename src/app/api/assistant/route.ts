import type { AssistantConversationMessage } from "@/lib/assistant/types";
import { NextResponse } from "next/server";
import { z } from "zod";
import { answerAssistantQuestion } from "@/lib/assistant/openai";
import { requireConnectedSession } from "@/lib/auth/session";
import { hasFeatureAccess } from "@/lib/features";
import { enforceRateLimit, getRateLimitIdentifier, rateLimitHeaders } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

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
    .optional()
});

export async function POST(request: Request) {
  const auth = await requireConnectedSession();
  if (!auth.ok) {
    return NextResponse.json(
      { message: auth.status === 401 ? "Authentication required." : "Connect a LiveMopay account first." },
      { status: auth.status }
    );
  }

  const [aiAssistantEnabled, activitiesEnabled] = await Promise.all([
    hasFeatureAccess(auth.session.userId, "ai"),
    hasFeatureAccess(auth.session.userId, "activities")
  ]);
  if (!aiAssistantEnabled) {
    return NextResponse.json({ message: "The energy assistant is disabled for your account." }, { status: 403 });
  }

  try {
    const identifier = getRateLimitIdentifier(auth.session.userId, "assistant");
    const rateLimit = await enforceRateLimit(identifier, "assistant");
    const rateHeaders = rateLimitHeaders(rateLimit);

    if (!rateLimit.allowed) {
      return NextResponse.json(
        { message: "Rate limit exceeded. Please try again later." },
        { status: 429, headers: rateHeaders }
      );
    }

    const body = requestSchema.parse(await request.json());
    const result = await answerAssistantQuestion(
      auth.session.accessToken,
      body.question,
      {
        from: body.from,
        to: body.to
      },
      (body.history ?? []) as AssistantConversationMessage[],
      { activitiesEnabled }
    );

    return NextResponse.json(
      {
        answer: result.answer,
        toolsUsed: result.toolsUsed,
        scope: {
          from: body.from ?? "",
          to: body.to ?? ""
        }
      },
      { headers: rateHeaders }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to answer assistant question.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
