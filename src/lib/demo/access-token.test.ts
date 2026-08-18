import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isValidDemoAccessToken } from "./access-token";

const ENV_KEY = "NEWINMETER_DEMO_ACCESS_TOKEN";

describe("isValidDemoAccessToken", () => {
  const original = process.env[ENV_KEY];

  beforeEach(() => {
    process.env[ENV_KEY] = "correct-horse-battery-staple";
  });

  afterEach(() => {
    if (original === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = original;
  });

  it("accepts the exact configured token", () => {
    expect(isValidDemoAccessToken("correct-horse-battery-staple")).toBe(true);
  });

  it("rejects a wrong token", () => {
    expect(isValidDemoAccessToken("wrong-token")).toBe(false);
  });

  it("rejects a token that only differs by a trailing character", () => {
    expect(isValidDemoAccessToken("correct-horse-battery-staplex")).toBe(false);
  });

  it("rejects a token that is a prefix of the real one", () => {
    expect(isValidDemoAccessToken("correct-horse")).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(isValidDemoAccessToken("")).toBe(false);
  });

  it("rejects undefined and null", () => {
    expect(isValidDemoAccessToken(undefined)).toBe(false);
    expect(isValidDemoAccessToken(null)).toBe(false);
  });

  it("rejects any token when the feature is not configured", () => {
    delete process.env[ENV_KEY];
    expect(isValidDemoAccessToken("correct-horse-battery-staple")).toBe(false);
    expect(isValidDemoAccessToken("anything")).toBe(false);
  });

  it("rejects an empty configured token even if the candidate is also empty", () => {
    process.env[ENV_KEY] = "";
    expect(isValidDemoAccessToken("")).toBe(false);
  });
});
