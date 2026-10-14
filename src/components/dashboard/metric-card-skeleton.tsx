import { Skeleton } from "@/components/ui/skeleton";

export function MetricCardSkeleton({ label = "metric" }: { label?: string }) {
  return (
    <section
      role="status"
      aria-label={`Loading ${label}`}
      className="min-w-40 rounded-lg border border-line bg-paper p-4"
    >
      <Skeleton className="h-3 w-16" />
      <Skeleton className="mt-3 h-6 w-20" />
    </section>
  );
}
