import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { currentRequestTimeoutMs, fetchWithRequestBudget, withRequestBudget } from "./request-budget";
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
function stalledFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
        })
    )
  );
}
it("cancels work and lets cleanup use the remaining parent budget", async () => {
  stalledFetch();
  let cleanupWasAborted: boolean | undefined;
  const result = withRequestBudget(100, async () => {
    try {
      await withRequestBudget(20, () => fetchWithRequestBudget("https://example.com/work"));
    } catch (error) {
      vi.stubGlobal(
        "fetch",
        vi.fn((_url, init) => {
          cleanupWasAborted = init.signal.aborted;
          return Promise.resolve(new Response("{}"));
        })
      );
      await withRequestBudget(10, () => fetchWithRequestBudget("https://example.com/cleanup"));
      return error;
    }
  });
  await vi.advanceTimersByTimeAsync(21);
  expect(await result).toMatchObject({ name: "TimeoutError" });
  expect(cleanupWasAborted).toBe(false);
});
it("isolates concurrent request budgets", async () => {
  stalledFetch();
  const short = withRequestBudget(10, () => fetchWithRequestBudget("https://example.com/short")).catch((e) => e);
  const long = withRequestBudget(30, () => fetchWithRequestBudget("https://example.com/long")).catch((e) => e);
  await vi.advanceTimersByTimeAsync(11);
  expect(await short).toMatchObject({ name: "TimeoutError" });
  const calls = vi.mocked(fetch).mock.calls;
  expect(calls[1][1]?.signal?.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(20);
  expect(await long).toMatchObject({ name: "TimeoutError" });
});
it("does not extend a parent ceiling in nested work", async () => {
  stalledFetch();
  const result = withRequestBudget(20, () =>
    withRequestBudget(100, () => fetchWithRequestBudget("https://example.com/nested"))
  ).catch((e) => e);
  await vi.advanceTimersByTimeAsync(21);
  expect(await result).toMatchObject({ name: "TimeoutError" });
});
it("leaves requests outside a budget unchanged", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}")));
  const options = { method: "POST", body: "{}" };
  await fetchWithRequestBudget("https://example.com/manual", options);
  expect(fetch).toHaveBeenCalledWith("https://example.com/manual", options);
});

it("bounds native HTTP timeouts by the remaining parent budget", async () => {
  expect(currentRequestTimeoutMs()).toBeUndefined();
  await withRequestBudget(100, async () => {
    expect(currentRequestTimeoutMs()).toBe(100);
    vi.advanceTimersByTime(40);
    expect(currentRequestTimeoutMs()).toBe(60);
  });
});
