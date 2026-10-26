import { Skeleton } from "@/components/ui/skeleton";

export function MetricCardSkeleton({ label = "metric" }: { label?: string }) {
  return (
    <section
      role="status"
      aria-label={`Loading ${label}`}
      className="min-w-40 rounded-lg border border-line bg-paper p-4"
    >
      <Skeleton className="h-5 w-16 max-w-full" />
      <Skeleton className="mt-3 h-7 w-20 max-w-full sm:h-8" />
      <Skeleton className="mt-2 h-4 w-32 max-w-full" />
    </section>
  );
}
