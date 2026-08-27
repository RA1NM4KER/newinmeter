import "server-only";

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { NextResponse } from "next/server";

export const RATE_LIMIT_POLICIES = {
  default: {
    minuteLimit: 60,
    dayLimit: 1000
  },
  assistant: {
    minuteLimit: 5,
    dayLimit: 30
  },
  // Assistant-proposed mutations (set/update/disable alert, add activity,
  // sync) confirmed by the user in the UI. Separate from the "assistant"
  // policy above (which limits questions/turns) so a chatty conversation
  // never eats into the much smaller budget a user actually needs for
  // confirming a handful of actions.
  assistantAction: {
    minuteLimit: 10,
    dayLimit: 50
  },
  // Manual sync performs an authenticated LiveMopay refresh and database
  // rollup. Normal use is a few deliberate clicks, never a polling loop.
  sync: {
    minuteLimit: 3,
    dayLimit: 20
  },
  // Connect/reconnect/account-selection calls reach LiveMopay or mutate
  // connection state. Kept separate from assistant questions.
  external: {
    minuteLimit: 10,
    dayLimit: 100
  },
  // Exports can scan and serialize a user's full selected range.
  export: {
    minuteLimit: 10,
    dayLimit: 100
  },
  // Physical meter devices upload small batches roughly every 5 seconds
  // (~12 req/min, ~17,280 req/day), so the default 1,000/day user policy would
  // break ingestion within the hour. This dedicated policy is keyed by the
  // authenticated device id (never IP), with generous headroom for retries and
  // faster upload intervals, and does not touch the user/assistant policies.
  meter: {
    minuteLimit: 60,
    dayLimit: 30000
  },
  // The Live page polls the overview endpoint ~every 5s while open
  // (~12 req/min, ~17,280 req/day), so it needs the same headroom as ingestion
  // rather than the 1,000/day default. Keyed by the authenticated user id.
  live: {
    minuteLimit: 30,
    dayLimit: 30000
  },
  // /api/demo-login is unauthenticated by nature (that's the whole point --
  // one click, no inbox needed), so it's keyed by request IP instead of a
  // user id. Tight on purpose: this is the endpoint an attacker would use to
  // brute-force NEWINMETER_DEMO_ACCESS_TOKEN, and legitimate use is at most
  // a handful of clicks per recruiter.
  demoLogin: {
    minuteLimit: 5,
    dayLimit: 30
  }
} as const;

export type RateLimitPolicyName = keyof typeof RATE_LIMIT_POLICIES;

export type RateLimitState = {
  success: boolean;
  limit: number;
  remaining: number;
  reset: number;
};

export type RateLimitResult = {
  allowed: boolean;
  minute: RateLimitState;
  day: RateLimitState;
};

// Backed by Upstash Redis so limits actually hold across serverless
// instances and cold starts -- a plain in-memory counter resets per
// instance on Vercel and doesn't enforce anything reliably. Lazily
// constructed so missing env vars only break the first real request, not
// module import (build/static analysis).
//
// Supports both naming conventions: UPSTASH_REDIS_REST_URL/TOKEN (signing
// up at upstash.com directly) and KV_REST_API_URL/TOKEN (Vercel's Upstash
// Marketplace integration, which keeps the older Vercel KV variable names).
let redis: Redis | null = null;

function getRedis(): Redis {
  if (!redis) {
    const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;

    if (!url || !token) {
      throw new Error("Missing Upstash Redis credentials (UPSTASH_REDIS_REST_URL/TOKEN or KV_REST_API_URL/TOKEN).");
    }

    redis = new Redis({ url, token });
  }

  return redis;
}

const limitersByPolicy = new Map<RateLimitPolicyName, { minute: Ratelimit; day: Ratelimit }>();

function getLimiters(policyName: RateLimitPolicyName) {
  const cached = limitersByPolicy.get(policyName);
  if (cached) {
    return cached;
  }

  const policy = RATE_LIMIT_POLICIES[policyName];
  const client = getRedis();
  const created = {
    minute: new Ratelimit({
      redis: client,
      limiter: Ratelimit.slidingWindow(policy.minuteLimit, "1 m"),
      prefix: `ratelimit:${policyName}:minute`
    }),
    day: new Ratelimit({
      redis: client,
      limiter: Ratelimit.slidingWindow(policy.dayLimit, "1 d"),
      prefix: `ratelimit:${policyName}:day`
    })
  };

  limitersByPolicy.set(policyName, created);
  return created;
}

// Identifier is always built from the authenticated user id, never IP --
// every caller of this already resolves a session before rate limiting, and
// keying by IP either double-counts users sharing a network or lets a
// single user reset their own limit by switching networks.
export function getRateLimitIdentifier(userId: string, scope?: string) {
  return scope ? `${userId}:${scope}` : userId;
}

export function getTrustedRequestIp(request: Request): string {
  // Vercel documents x-vercel-forwarded-for as its platform-generated copy
  // of the client IP. Only trust it when actually running on Vercel; local
  // callers can forge arbitrary forwarding headers and therefore share one
  // explicit development bucket instead.
  if (process.env.VERCEL !== "1") return "local";
  const forwarded = request.headers.get("x-vercel-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || "unknown";
}

export async function enforceRateLimit(
  identifier: string,
  policyName: RateLimitPolicyName = "default"
): Promise<RateLimitResult> {
  const { minute, day } = getLimiters(policyName);
  const [minuteResult, dayResult] = await Promise.all([minute.limit(identifier), day.limit(identifier)]);

  const minuteState: RateLimitState = {
    success: minuteResult.success,
    limit: minuteResult.limit,
    remaining: minuteResult.remaining,
    reset: Math.ceil(minuteResult.reset / 1000)
  };

  const dayState: RateLimitState = {
    success: dayResult.success,
    limit: dayResult.limit,
    remaining: dayResult.remaining,
    reset: Math.ceil(dayResult.reset / 1000)
  };

  return {
    allowed: minuteState.success && dayState.success,
    minute: minuteState,
    day: dayState
  };
}

export function rateLimitHeaders(result: RateLimitResult) {
  const headers: Record<string, string> = {
    "X-RateLimit-Limit-Minute": String(result.minute.limit),
    "X-RateLimit-Remaining-Minute": String(result.minute.remaining),
    "X-RateLimit-Reset-Minute": String(result.minute.reset),
    "X-RateLimit-Limit-Day": String(result.day.limit),
    "X-RateLimit-Remaining-Day": String(result.day.remaining),
    "X-RateLimit-Reset-Day": String(result.day.reset)
  };
  if (!result.allowed) {
    const blockedResets = [result.minute, result.day].filter((state) => !state.success).map((state) => state.reset);
    headers["Retry-After"] = String(Math.max(1, Math.max(...blockedResets) - Math.floor(Date.now() / 1000)));
  }
  return headers;
}

export async function limitUserRequest(
  userId: string,
  scope: string,
  policy: RateLimitPolicyName = "default"
) {
  const result = await enforceRateLimit(getRateLimitIdentifier(userId, scope), policy);
  const headers = rateLimitHeaders(result);
  return {
    allowed: result.allowed,
    headers,
    response: result.allowed
      ? null
      : NextResponse.json(
          { message: "Rate limit exceeded. Please try again later." },
          { status: 429, headers }
        )
  };
}
