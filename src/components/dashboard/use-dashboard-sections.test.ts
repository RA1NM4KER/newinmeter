import { afterEach, expect, it, vi } from "vitest";
import { fetchDashboardSection } from "./use-dashboard-sections";
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it.each(["query cancellation", "request deadline"])("aborts a stalled fetch on %s", async (source) => {
  const query = new AbortController();
  const deadline = new AbortController();
  vi.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
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
  const request = fetchDashboardSection("daily", query.signal);
  (source === "query cancellation" ? query : deadline).abort();
  await expect(request).rejects.toMatchObject({ name: "AbortError" });
  expect(AbortSignal.timeout).toHaveBeenCalledWith(20000);
});
