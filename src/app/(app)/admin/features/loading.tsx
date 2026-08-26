import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function AdminFeaturesLoading() {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <Card className="overflow-hidden">
        {Array.from({ length: 4 }, (_, index) => (
          <div
            className="flex items-center justify-between gap-4 border-t border-line px-4 py-3.5 first:border-t-0"
            key={index}
          >
            <div className="min-w-0 flex-1">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="mt-2 h-3 w-full max-w-64" />
            </div>
            <Skeleton className="h-3 w-20 shrink-0" />
          </div>
        ))}
      </Card>
    </div>
  );
}
