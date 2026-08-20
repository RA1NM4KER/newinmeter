import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { StatTileProps } from "./types";

export function StatTile({ label, value, tone = "default" }: StatTileProps) {
  return (
    <Card className="flex-1 px-2 py-2 sm:px-4 sm:py-3">
      <p className="truncate text-[0.6rem] uppercase tracking-[0.1em] text-muted sm:text-xs sm:tracking-[0.12em]">
        {label}
      </p>
      <p
        className={`mt-1 text-lg font-semibold tabular-nums sm:text-2xl ${tone === "warning" && value > 0 ? "text-red-500" : "text-ink"}`}
      >
        {value}
      </p>
    </Card>
  );
}

export function StatStripSkeleton() {
  return (
    <div className="grid grid-cols-4 gap-2 sm:gap-3">
      {Array.from({ length: 4 }, (_, index) => (
        <Card key={index} className="px-2 py-2 sm:px-4 sm:py-3">
          <Skeleton className="h-3 w-10 sm:w-16" />
          <Skeleton className="mt-2 h-5 w-6 sm:h-7 sm:w-10" />
        </Card>
      ))}
    </div>
  );
}
