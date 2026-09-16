"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, ArchiveRestore, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ConnectionDataState } from "@/lib/newinmeter/connection";

type StatusPayload = {
  dataState?: ConnectionDataState;
  error?: string | null;
  reconnectRequired?: boolean;
  message?: string;
};

export function RestorationStatus({
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
  const started = useRef(false);

  const start = useCallback(async () => {
    setState("restoring");
    setError(null);
    try {
      const response = await fetch("/api/restoration", { method: "POST" });
      const body = (await response.json().catch(() => ({}))) as StatusPayload;
      if (response.ok && body.dataState === "warm") {
        setState("warm");
        router.replace("/");
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
      setState(body.dataState);
      setError(body.error ?? null);
      setReconnectRequired(Boolean(body.reconnectRequired));
      if (body.dataState === "warm") {
        router.replace("/");
        router.refresh();
      }
    }, 3000);
    return () => window.clearInterval(timer);
  }, [router, state]);

  if (state === "restore_failed") {
    return (
      <div className="rounded-2xl border border-red-200 bg-paper px-6 py-7 text-left" role="alert">
        <AlertCircle className="h-5 w-5 text-red-700" aria-hidden="true" />
        <h2 className="mt-3 text-base font-semibold text-ink">We couldn’t restore your recent history</h2>
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
    );
  }

  return (
    <div className="rounded-2xl border border-line bg-paper px-6 py-8 text-left" aria-live="polite">
      {state === "warm" ? (
        <CheckCircle2 className="h-6 w-6 text-brandTeal" aria-hidden="true" />
      ) : state === "hibernating" ? (
        <ArchiveRestore className="h-6 w-6 text-accent" aria-hidden="true" />
      ) : (
        <Loader2 className="h-6 w-6 animate-spin text-accent" aria-hidden="true" />
      )}
      <h2 className="mt-3 text-base font-semibold text-ink">
        {state === "hibernating" ? "Preparing your archived data" : "Rebuilding your latest 90 days"}
      </h2>
      <p className="mt-1.5 text-sm leading-relaxed text-muted">
        You can leave this page and come back. Refreshing won’t start another restoration, and older history remains
        available as daily summaries.
      </p>
    </div>
  );
}
