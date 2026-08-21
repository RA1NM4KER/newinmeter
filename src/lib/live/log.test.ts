import { afterEach, describe, expect, it, vi } from "vitest";
import { logLiveError, redact } from "@/lib/live/log";

// NOTE: all secret-looking values here are assembled from fragments at runtime
// rather than written as literals, so automated secret scanners (GitGuardian)
// don't false-positive on the test fixtures. They are entirely fabricated --
// real device keys are `nm_dev_` + 43 base64url chars.
const FAKE_KEY = `nm_dev_${"Example".repeat(3)}`; // clearly not a real key
const FAKE_HASH = "9f8e7d6c".repeat(8); // 64 hex chars, fabricated

describe("redact", () => {
  it("strips bearer tokens", () => {
    expect(redact(`Authorization: Bearer ${FAKE_KEY}`)).toBe("Authorization: Bearer <redacted>");
  });

  it("strips nm_dev_ device keys anywhere", () => {
    expect(redact(`key ${FAKE_KEY} used`)).toBe("key nm_dev_<redacted> used");
  });

  it("strips api_key_hash query values (the device-auth lookup URL)", () => {
    const msg = `GET /meter_devices?select=id&api_key_hash=eq.${FAKE_HASH} failed (500)`;
    const out = redact(msg);
    expect(out).not.toContain(FAKE_HASH);
    expect(out).toContain("api_key_hash=<redacted>");
  });

  it("strips long hex digests (sha256)", () => {
    const hash = "a".repeat(64);
    expect(redact(`hash=${hash}`)).not.toContain(hash);
  });

  it("leaves non-secret text intact", () => {
    expect(redact("device 7b8ee585 accepted=5 duplicates=1")).toBe("device 7b8ee585 accepted=5 duplicates=1");
  });
});

describe("logLiveError", () => {
  afterEach(() => vi.restoreAllMocks());

  it("emits one JSON line with the category and redacted message, never a raw secret", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logLiveError("live_ingest_auth_error", new Error(`Bearer ${FAKE_KEY} failed`), { reqId: "abcd1234" });

    expect(spy).toHaveBeenCalledTimes(1);
    const line = spy.mock.calls[0][0] as string;
    const parsed = JSON.parse(line);
    expect(parsed.evt).toBe("live_ingest_auth_error");
    expect(parsed.reqId).toBe("abcd1234");
    expect(line).not.toContain(FAKE_KEY);
    expect(parsed.error).toContain("<redacted>");
  });

  it("redacts secrets embedded in structured string fields too", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logLiveError("live_ingest_error", "boom", { detail: `token ${FAKE_KEY}` });
    const line = spy.mock.calls[0][0] as string;
    expect(line).not.toContain(FAKE_KEY);
  });
});
