"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

export function DiagnosticsRefreshButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <button
      aria-label="Refresh diagnostics"
      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted transition hover:bg-canvas hover:text-ink disabled:cursor-not-allowed disabled:opacity-60"
      disabled={isPending}
      onClick={() => startTransition(() => router.refresh())}
      title="Refresh diagnostics"
      type="button"
    >
      <RefreshCw aria-hidden="true" className={`h-4 w-4 ${isPending ? "animate-spin" : ""}`} />
    </button>
  );
}
