import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fetchDashboardSection } from "./use-dashboard-sections";
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("loads successfully without AbortSignal.any or timeout (iOS 16)", async () => {
  vi.stubGlobal("AbortSignal", { any: undefined, timeout: undefined });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ latestBalance: 300 })));
  const query = new AbortController();
  expect(await fetchDashboardSection("summary", query.signal)).toEqual({ latestBalance: 300 });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});
it.each(["query cancellation", "request deadline"])("aborts a stalled fetch on %s", async (source) => {
  const query = new AbortController();
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), {
            once: true
          });
        })
    )
  );
  const result = fetchDashboardSection("daily", query.signal).catch((e) => e);
  if (source === "query cancellation") query.abort();
  else await vi.advanceTimersByTimeAsync(20000);
  expect(await result).toMatchObject({ name: "AbortError" });
  expect(vi.getTimerCount()).toBe(0);
});
it("keeps the deadline active until the response body finishes", async () => {
  const query = new AbortController();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url, init) => ({
      ok: true,
      json: () =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), {
            once: true
          });
        })
    }))
  );
  const result = fetchDashboardSection("hourly", query.signal).catch((e) => e);
  await vi.advanceTimersByTimeAsync(20000);
  expect(await result).toMatchObject({ name: "AbortError" });
  expect(vi.getTimerCount()).toBe(0);
});
it("removes the query cancellation listener after completion", async () => {
  const query = new AbortController();
  const remove = vi.spyOn(query.signal, "removeEventListener");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json([])));
  await fetchDashboardSection("daily", query.signal);
  expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
});
