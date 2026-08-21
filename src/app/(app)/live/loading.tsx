import { LivePageHeader } from "@/components/live/live-page-header";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

// Route-level navigation skeleton for /live. Without this, the segment falls
// back to the group-level (app)/loading.tsx (the dashboard skeleton), which is
// the wrong shape. The header is static text, so it renders for real
// immediately -- only the data-dependent card and recent strip are skeletoned.
export default function LiveLoading() {
  return (
    <div className="mx-auto w-full max-w-5xl">
      <LivePageHeader />

      <Card className="overflow-hidden">
        <div className="flex flex-col gap-4 px-4 pt-5 sm:flex-row sm:items-start sm:justify-between sm:px-6">
          <div>
            <Skeleton className="h-3 w-24" />
            <Skeleton className="mt-3 h-12 w-40" />
            <Skeleton className="mt-3 h-4 w-56" />
          </div>
          <Skeleton className="h-9 w-full rounded-lg sm:w-56" />
        </div>
        <Skeleton className="mx-4 mt-4 h-[280px] rounded-lg sm:mx-6 sm:h-[300px]" />
        <div className="px-4 py-4 sm:px-6">
          <Skeleton className="h-3 w-72 max-w-full" />
        </div>
      </Card>

      <div className="mt-4 grid grid-cols-3 divide-x divide-line overflow-hidden rounded-lg border border-line bg-paper">
        {Array.from({ length: 3 }, (_, index) => (
          <div key={index} className="px-3 py-4 sm:px-5">
            <Skeleton className="h-3 w-14" />
            <Skeleton className="mt-2 h-6 w-16" />
            <Skeleton className="mt-2 h-3 w-12" />
          </div>
        ))}
      </div>
    </div>
  );
}
