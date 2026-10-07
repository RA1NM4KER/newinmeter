"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MAP_POLL_MS, isMapStale, systemMapSnapshotSchema, type SystemMapSnapshot } from "@/lib/system-map/model";

export function useSystemMap(initialSnapshot: SystemMapSnapshot | null) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const inFlight = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const denied = useRef(false);
  const retryAt = useRef(0);

  const refresh = useCallback(async () => {
    if (!mounted.current || inFlight.current || denied.current || Date.now() < retryAt.current) return;
    const controller = new AbortController();
    inFlight.current = controller;
    setRefreshing(true);
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch("/api/admin/system", { cache: "no-store", signal: controller.signal });
      if (!mounted.current || controller.signal.aborted) return;
      if (response.status === 401 || response.status === 403) {
        denied.current = true;
        setSnapshot(null);
        setError("Admin access is no longer available. Sign in with an admin account and reload this page.");
        return;
      }
      if (response.status === 429) {
        const seconds = Number(response.headers.get("Retry-After"));
        retryAt.current = Date.now() + (Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : MAP_POLL_MS);
        throw new Error("rate-limit");
      }
      if (!response.ok) throw new Error("unavailable");
      const next = systemMapSnapshotSchema.parse(await response.json());
      if (!mounted.current || controller.signal.aborted) return;
      setSnapshot(next);
      setError(null);
      setNow(Date.now());
    } catch {
      if (mounted.current && inFlight.current === controller)
        setError("Health refresh failed. Displayed evidence may be out of date; automatic retries will continue.");
    } finally {
      clearTimeout(timeout);
      if (inFlight.current === controller) {
        inFlight.current = null;
        if (mounted.current) setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    // Revalidate on arrival, including navigation back to a prefetched page.
    void refresh();
    const poll = setInterval(() => {
      if (!document.hidden) void refresh();
    }, MAP_POLL_MS);
    const clock = setInterval(() => setNow(Date.now()), 15_000);
    const onVisible = () => {
      if (!document.hidden) {
        setNow(Date.now());
        void refresh();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      mounted.current = false;
      clearInterval(poll);
      clearInterval(clock);
      document.removeEventListener("visibilitychange", onVisible);
      inFlight.current?.abort();
      inFlight.current = null;
    };
  }, [refresh]);

  return { snapshot, refreshing, error, refresh, stale: !!snapshot && (!!error || isMapStale(snapshot, now)) };
}
