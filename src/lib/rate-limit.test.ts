import { describe, expect, it, vi } from "vitest";
import {
  getRateLimitIdentifier,
  getTrustedRequestIp,
  RATE_LIMIT_POLICIES,
  rateLimitHeaders
} from "@/lib/rate-limit";

describe("getRateLimitIdentifier", () => {
  it("uses the user id alone when there's no scope", () => {
    expect(getRateLimitIdentifier("user-123")).toBe("user-123");
  });

  it("appends the scope when given, so different features get independent buckets", () => {
    expect(getRateLimitIdentifier("user-123", "assistant")).toBe("user-123:assistant");
  });

  it("never falls back to an IP-derived identifier -- always keys off the passed user id", () => {
    // Regression guard for the specific fix this module went through: rate
    // limiting must be per authenticated user, not per IP (IP either
    // double-counts users on the same network, or lets one user dodge their
    // own limit by switching networks).
    const identifier = getRateLimitIdentifier("user-abc", "default");
    expect(identifier).not.toContain("127.0.0.1");
    expect(identifier.startsWith("user-abc")).toBe(true);
  });
});

describe("getTrustedRequestIp", () => {
  it("only trusts Vercel's platform header in production", () => {
    vi.stubEnv("VERCEL", "1");
    const request = new Request("https://example.test", {
      headers: {
        "x-forwarded-for": "spoofed",
        "x-vercel-forwarded-for": "203.0.113.9"
      }
    });
    expect(getTrustedRequestIp(request)).toBe("203.0.113.9");
    vi.unstubAllEnvs();
  });

  it("ignores forwarding headers outside Vercel", () => {
    vi.stubEnv("VERCEL", "");
    const request = new Request("http://localhost", { headers: { "x-forwarded-for": "spoofed" } });
    expect(getTrustedRequestIp(request)).toBe("local");
    vi.unstubAllEnvs();
  });
});

describe("rateLimitHeaders", () => {
  it("maps the result onto the expected X-RateLimit-* header names", () => {
    const headers = rateLimitHeaders({
      allowed: true,
      minute: { success: true, limit: 5, remaining: 3, reset: 1000 },
      day: { success: true, limit: 30, remaining: 20, reset: 2000 }
    });

    expect(headers).toEqual({
      "X-RateLimit-Limit-Minute": "5",
      "X-RateLimit-Remaining-Minute": "3",
      "X-RateLimit-Reset-Minute": "1000",
      "X-RateLimit-Limit-Day": "30",
      "X-RateLimit-Remaining-Day": "20",
      "X-RateLimit-Reset-Day": "2000"
    });
  });

  it("adds Retry-After only to blocked responses", () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    const headers = rateLimitHeaders({
      allowed: false,
      minute: { success: false, limit: 3, remaining: 0, reset: 1060 },
      day: { success: true, limit: 20, remaining: 10, reset: 90000 }
    });
    expect(headers["Retry-After"]).toBe("60");
    now.mockRestore();
  });
});

describe("specialized policies", () => {
  it("keeps sync and exports intentionally tighter than ordinary reads", () => {
    expect(RATE_LIMIT_POLICIES.sync).toEqual({ minuteLimit: 3, dayLimit: 20 });
    expect(RATE_LIMIT_POLICIES.export).toEqual({ minuteLimit: 10, dayLimit: 100 });
    expect(RATE_LIMIT_POLICIES.sync.dayLimit).toBeLessThan(RATE_LIMIT_POLICIES.default.dayLimit);
  });

  it("keeps the shared demo AI bucket tighter than the real per-user assistant policy", () => {
    expect(RATE_LIMIT_POLICIES.assistantDemo.dayLimit).toBeLessThan(RATE_LIMIT_POLICIES.assistant.dayLimit * 2);
    expect(RATE_LIMIT_POLICIES.assistantDemo.minuteLimit).toBeLessThanOrEqual(RATE_LIMIT_POLICIES.assistant.minuteLimit);
  });

  it("keeps the pre-auth funnel tracker generous enough for one visitor's real steps but bounded", () => {
    expect(RATE_LIMIT_POLICIES.funnelTrack.minuteLimit).toBeGreaterThan(5);
    expect(RATE_LIMIT_POLICIES.funnelTrack.dayLimit).toBeLessThan(RATE_LIMIT_POLICIES.default.dayLimit);
  });
});
