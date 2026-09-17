import { Skeleton } from "@/components/ui/skeleton";

export function DataCardSkeletonList({ count }: { count: number }) {
  return (
    <div className="divide-y divide-line">
      {Array.from({ length: count }, (_, index) => (
        <div className="flex flex-col gap-2 px-4 py-3" key={`card-skeleton-${index}`}>
          <div className="flex items-center justify-between gap-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-14" />
          </div>
          <Skeleton className="h-3.5 w-40" />
          <div className="flex items-center justify-between gap-2 pt-0.5">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-3.5 w-36" />
          </div>
        </div>
      ))}
    </div>
  );
}
