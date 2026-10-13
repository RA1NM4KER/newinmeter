import { Pause, Snowflake, LoaderCircle, CircleAlert } from "lucide-react";
import type { ConnectionLifecycle } from "@/lib/connection-lifecycle";

export function LifecycleIcon({ lifecycle }: { lifecycle: ConnectionLifecycle }) {
  const label =
    lifecycle === "cold" ? "Cold / purged" : lifecycle[0].toUpperCase() + lifecycle.slice(1).replace("_", " ");
  const Icon =
    lifecycle === "paused"
      ? Pause
      : lifecycle === "cold"
        ? Snowflake
        : lifecycle === "restore_failed"
          ? CircleAlert
          : LoaderCircle;
  return (
    <span
      className="inline-flex h-3 w-3 shrink-0 items-center justify-center"
      role="img"
      aria-label={label}
      title={label}
    >
      {lifecycle === "active" ? (
        <span className="h-1.5 w-1.5 rounded-full bg-accent" />
      ) : (
        <Icon aria-hidden="true" className={`h-3 w-3 ${lifecycle === "cold" ? "text-sky-400" : "text-muted"}`} />
      )}
    </span>
  );
}
