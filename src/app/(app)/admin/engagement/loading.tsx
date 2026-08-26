import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function AdminEngagementLoading() {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto pb-5">
      <Skeleton className="mb-2.5 ml-1 h-3 w-28" />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
        {Array.from({ length: 4 }, (_, index) => (
          <Card className="px-2 py-2 sm:px-4 sm:py-3" key={index}>
            <Skeleton className="h-3 w-16" />
            <Skeleton className="mt-2 h-6 w-8" />
          </Card>
        ))}
      </div>
      <Skeleton className="mb-2.5 ml-1 mt-5 h-3 w-28" />
      <Card className="overflow-hidden">
        {Array.from({ length: 5 }, (_, index) => (
          <div
            className="flex items-center justify-between border-t border-line px-4 py-3 first:border-t-0"
            key={index}
          >
            <div className="flex-1">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="mt-2 h-3 w-48 max-w-full" />
            </div>
            <Skeleton className="h-5 w-12" />
          </div>
        ))}
      </Card>
    </div>
  );
}
