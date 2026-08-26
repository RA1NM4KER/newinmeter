import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export function DiagnosticsSkeleton() {
  return (
    <div className="flex flex-col gap-5 pb-5">
      <Card className="overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3.5">
          <Skeleton className="h-2 w-2 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1">
            <Skeleton className="h-4 w-44" />
            <Skeleton className="mt-2 h-3 w-24" />
          </div>
          <Skeleton className="h-9 w-9 shrink-0 rounded-md" />
        </div>
        {Array.from({ length: 4 }, (_, index) => (
          <div className="flex items-center justify-between border-t border-line px-4 py-2.5" key={index}>
            <Skeleton className="h-3.5 w-28" />
            <Skeleton className="h-3 w-16" />
          </div>
        ))}
      </Card>

      <section>
        <Skeleton className="mb-2.5 ml-1 h-3 w-28" />
        <Card className="px-4 py-3.5">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="mt-2 h-3 w-64 max-w-full" />
        </Card>
      </section>

      <section>
        <Skeleton className="mb-2.5 ml-1 h-3 w-24" />
        <Skeleton className="ml-1 h-3.5 w-40" />
      </section>
    </div>
  );
}
