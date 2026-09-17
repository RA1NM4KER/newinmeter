import { Skeleton } from "@/components/ui/skeleton";

export function AdminCardSkeletonList({ count }: { count: number }) {
  return (
    <div className="divide-y divide-line">
      {Array.from({ length: count }, (_, index) => (
        <div className="flex flex-col gap-2 px-4 py-3" key={`admin-card-skeleton-${index}`}>
          <div className="flex items-center justify-between gap-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3.5 w-16" />
          </div>
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-3.5 w-28" />
          <Skeleton className="h-5 w-14" />
        </div>
      ))}
    </div>
  );
}
