import { describe, expect, it } from "vitest";
import { validateDemoSeedTarget } from "./seed-safety";

describe("demo seed target safety", () => {
  it("allows a new target or the one existing demo connection", () => {
    expect(validateDemoSeedTarget([])).toBeNull();
    expect(validateDemoSeedTarget([{ id: "demo", is_demo: true }])).toEqual({ id: "demo", is_demo: true });
  });

  it("refuses a real connection or an ambiguous multi-connection account", () => {
    expect(() => validateDemoSeedTarget([{ id: "real", is_demo: false }])).toThrow("not marked is_demo");
    expect(() =>
      validateDemoSeedTarget([
        { id: "one", is_demo: true },
        { id: "two", is_demo: true }
      ])
    ).toThrow("Refusing to guess");
  });
});
