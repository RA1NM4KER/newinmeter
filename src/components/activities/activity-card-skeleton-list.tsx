import { Skeleton } from "@/components/ui/skeleton";

export function ActivityCardSkeletonList({ count }: { count: number }) {
  return (
    <div className="divide-y divide-line">
      {Array.from({ length: count }, (_, index) => (
        <div className="flex flex-col gap-2 px-4 py-3" key={`activity-card-skeleton-${index}`}>
          <div className="flex items-center justify-between gap-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-7 w-7 rounded-md" />
          </div>
          <Skeleton className="h-3.5 w-48" />
          <Skeleton className="h-3.5 w-56" />
          <Skeleton className="h-3.5 w-40" />
        </div>
      ))}
    </div>
  );
}
