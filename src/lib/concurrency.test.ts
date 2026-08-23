import { describe, expect, it } from "vitest";
import { mapWithConcurrency } from "./concurrency";

describe("mapWithConcurrency", () => {
  it("never exceeds the concurrency limit", async () => {
    let active = 0;
    let maxActive = 0;

    await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7, 8], 3, async (item) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return item * 2;
    });

    expect(maxActive).toBeLessThanOrEqual(3);
  });

  it("preserves result order matching input order", async () => {
    const results = await mapWithConcurrency([3, 1, 2], 3, async (item) => {
      await new Promise((resolve) => setTimeout(resolve, item));
      return item;
    });

    expect(results.map((r) => (r.status === "fulfilled" ? r.value : null))).toEqual([3, 1, 2]);
  });

  it("does not let one rejection abort the others", async () => {
    const results = await mapWithConcurrency([1, 2, 3], 2, async (item) => {
      if (item === 2) throw new Error("boom");
      return item;
    });

    expect(results[0]).toMatchObject({ status: "fulfilled", value: 1 });
    expect(results[1].status).toBe("rejected");
    expect(results[2]).toMatchObject({ status: "fulfilled", value: 3 });
  });

  it("handles an empty list", async () => {
    const results = await mapWithConcurrency([], 5, async (item) => item);
    expect(results).toEqual([]);
  });
});
