"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, ArchiveRestore, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ConnectionDataState } from "@/lib/newinmeter/connection";

type StatusPayload = {
  dataState?: ConnectionDataState;
  error?: string | null;
  reconnectRequired?: boolean;
  message?: string;
};

// Renders on top of the dashboard's own blurred shell (see the (app) layout)
// instead of replacing it with a separate /restore page: this is what a
// returning cold/hibernating user actually lands on, not a foreign-feeling
// screen they get bounced to. Same restoration mechanics as before (poll
// /api/restoration, auto-start from "cold"), the only real difference is
// what happens on success: a dialog closes and the page it's covering
// refreshes with real data, rather than a route replace to somewhere else,
// since there's nowhere else to go, this already is the dashboard.
export function RestorationOverlay({
  initialState,
  initialError,
  reconnectRequired: initialReconnectRequired
}: {
  initialState: ConnectionDataState;
  initialError: string | null;
  reconnectRequired: boolean;
}) {
  const router = useRouter();
  const [state, setState] = useState(initialState);
  const [error, setError] = useState(initialError);
  const [reconnectRequired, setReconnectRequired] = useState(initialReconnectRequired);
  const [closing, setClosing] = useState(false);
  const started = useRef(false);

  const start = useCallback(async () => {
    setState("restoring");
    setError(null);
    try {
      const response = await fetch("/api/restoration", { method: "POST" });
      const body = (await response.json().catch(() => ({}))) as StatusPayload;
      if (response.ok && body.dataState === "warm") {
        setClosing(true);
        router.refresh();
        return;
      }
      if (body.reconnectRequired) {
        setReconnectRequired(true);
        setState("restore_failed");
        setError(body.message ?? "Reconnect your LiveMopay account to continue.");
        return;
      }
      if (!response.ok) {
        setState("restore_failed");
        setError(body.message ?? "Restoration failed. Please retry.");
      }
    } catch {
      setState("restore_failed");
      setError("The restoration request was interrupted. It is safe to retry.");
    }
  }, [router]);

  useEffect(() => {
    if (state === "cold" && !started.current) {
      started.current = true;
      void start();
    }
  }, [start, state]);

  useEffect(() => {
    if (state !== "restoring" && state !== "hibernating") return;
    const timer = window.setInterval(async () => {
      const response = await fetch("/api/restoration", { cache: "no-store" }).catch(() => null);
      if (!response?.ok) return;
      const body = (await response.json()) as StatusPayload;
      if (!body.dataState) return;
      if (body.dataState === "warm") {
        setClosing(true);
        router.refresh();
        return;
      }
      setState(body.dataState);
      setError(body.error ?? null);
      setReconnectRequired(Boolean(body.reconnectRequired));
    }, 3000);
    return () => window.clearInterval(timer);
  }, [router, state]);

  // router.refresh() re-renders the server layout with fresh data (now
  // data_state === 'warm'), which stops this component from being mounted
  // at all -- this local "closing" flag is only to fade the dialog out
  // immediately rather than have it hang around, visibly frozen, for the
  // one render cycle before that fresh server response lands.
  if (closing) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-ink/30 px-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={state === "restore_failed" ? "Restoration failed" : "Restoring your dashboard"}
    >
      {state === "restore_failed" ? (
        <div className="w-full max-w-sm rounded-2xl border border-red-200 bg-paper px-6 py-7 text-left shadow-xl">
          <AlertCircle className="h-5 w-5 text-red-700" aria-hidden="true" />
          <h2 className="mt-3 text-base font-semibold text-ink">We couldn&rsquo;t restore your recent history</h2>
          <p className="mt-1.5 text-sm leading-relaxed text-muted">{error ?? "Please retry the restoration."}</p>
          <div className="mt-5 flex flex-wrap gap-3">
            {reconnectRequired ? (
              <Button href="/connect" variant="primary">
                Reconnect LiveMopay
              </Button>
            ) : (
              <Button variant="primary" onClick={() => void start()}>
                Try again
              </Button>
            )}
            <Button href="/auth/sign-out">Sign out</Button>
          </div>
        </div>
      ) : (
        <div className="w-full max-w-sm rounded-2xl border border-line bg-paper px-6 py-8 text-left shadow-xl" aria-live="polite">
          {state === "hibernating" ? (
            <ArchiveRestore className="h-6 w-6 text-accent" aria-hidden="true" />
          ) : (
            <Loader2 className="h-6 w-6 animate-spin text-accent" aria-hidden="true" />
          )}
          <h2 className="mt-3 text-base font-semibold text-ink">
            {state === "hibernating" ? "Preparing your archived data" : "Getting your latest data"}
          </h2>
          <p className="mt-1.5 text-sm leading-relaxed text-muted">
            You&rsquo;ll be looking at your dashboard in a moment. Older history remains available as daily summaries
            either way.
          </p>
        </div>
      )}
    </div>
  );
}
