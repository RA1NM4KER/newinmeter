"use client";

import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { MetricCardSkeleton } from "./metric-card-skeleton";
import { Button } from "@/components/ui/button";

export type SectionResource = { isPending: boolean; isError: boolean; refetch: () => unknown };
export function DashboardSectionState({
  label,
  resources,
  children,
  compact = false,
  hidePending = false
}: {
  label: string;
  resources: SectionResource[];
  children: ReactNode;
  compact?: boolean;
  hidePending?: boolean;
}) {
  const failed = resources.filter((resource) => resource.isError);
  if (failed.length)
    return (
      <section role="alert" className="rounded-xl border border-line bg-paper p-5">
        <p className="mb-3 text-sm text-muted">Unable to load {label}.</p>
        <Button size="sm" variant="secondary" onClick={() => failed.forEach((resource) => resource.refetch())}>
          Retry
        </Button>
      </section>
    );
  if (resources.some((resource) => resource.isPending)) {
    if (hidePending) return null;
    if (compact) return <MetricCardSkeleton label={label} />;
    return (
      <section
        role="status"
        aria-label={`Loading ${label}`}
        className={compact ? "min-w-40" : "rounded-xl border border-line bg-paper p-5"}
      >
        <Skeleton className={compact ? "h-28 w-full" : "h-80 w-full"} />
      </section>
    );
  }
  return <>{children}</>;
}
