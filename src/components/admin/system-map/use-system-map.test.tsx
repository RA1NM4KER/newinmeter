// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSystemMap } from "./use-system-map";
import { buildSystemMap } from "@/lib/system-map/resolve";
import { mapEvidence, MAP_TEST_TIME } from "../../../../test/system-map-fixture";
const snapshot = () => buildSystemMap(mapEvidence(), new Date());
const fetcher = vi.fn();
async function settle() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("system map polling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(MAP_TEST_TIME));
    vi.stubGlobal("fetch", fetcher);
    fetcher.mockReset().mockImplementation(async () => new Response(JSON.stringify(snapshot())));
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("polls every 45 seconds, skips hidden tabs, and refreshes on return", async () => {
    renderHook(() => useSystemMap(snapshot()));
    await settle();
    expect(fetcher).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(45_000);
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(90_000);
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    await settle();
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("keeps evidence but marks it stale after errors, then recovers", async () => {
    fetcher.mockRejectedValueOnce(new Error("network"));
    const { result } = renderHook(() => useSystemMap(snapshot()));
    await settle();
    expect(result.current.snapshot).not.toBeNull();
    expect(result.current.stale).toBe(true);
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.error).toBeNull();
    expect(result.current.stale).toBe(false);
  });

  it("removes evidence and stops polling when admin access is revoked", async () => {
    fetcher.mockResolvedValueOnce(new Response("{}", { status: 403 }));
    const { result } = renderHook(() => useSystemMap(snapshot()));
    await settle();
    expect(result.current.snapshot).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(90_000);
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed snapshots rather than crashing the map", async () => {
    fetcher.mockResolvedValueOnce(new Response('{"nodes":{}}'));
    const { result } = renderHook(() => useSystemMap(snapshot()));
    await settle();
    expect(result.current.error).not.toBeNull();
    expect(result.current.stale).toBe(true);
  });

  it("honors Retry-After and does not overlap pending requests", async () => {
    fetcher.mockResolvedValueOnce(new Response("{}", { status: 429, headers: { "Retry-After": "120" } }));
    const { result } = renderHook(() => useSystemMap(snapshot()));
    await settle();
    await act(async () => {
      await result.current.refresh();
      await vi.advanceTimersByTimeAsync(90_000);
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(45_000);
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("aborts an outstanding request on unmount", async () => {
    fetcher.mockImplementation(() => new Promise(() => {}));
    const { result, unmount } = renderHook(() => useSystemMap(snapshot()));
    await act(async () => {
      await result.current.refresh();
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const signal = fetcher.mock.calls[0][1].signal as AbortSignal;
    unmount();
    expect(signal.aborted).toBe(true);
  });
});
