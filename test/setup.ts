import { vi } from "vitest";

vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://rate-limit.test");
vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "test-token");

// Route tests exercise authentication, validation, and domain behavior; they
// must not contact the production Upstash service. Individual rate-limit
// tests still cover policy/header logic, and route tests can override this
// default when asserting a 429 path.
vi.mock("@upstash/redis", () => ({ Redis: vi.fn() }));
vi.mock("@upstash/ratelimit", () => {
  class RatelimitStub {
    static slidingWindow(limit: number) {
      return { limit };
    }

    private readonly configuredLimit: number;

    constructor(options: { limiter: { limit: number } }) {
      this.configuredLimit = options.limiter.limit;
    }

    async limit() {
      return {
        success: true,
        limit: this.configuredLimit,
        remaining: Math.max(0, this.configuredLimit - 1),
        reset: Date.now() + 60_000
      };
    }
  }

  return { Ratelimit: RatelimitStub };
});
