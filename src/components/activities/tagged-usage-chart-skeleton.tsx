import { Skeleton } from "@/components/ui/skeleton";

const barHeights = [34, 58, 45, 76, 52, 68, 39, 82, 61, 47, 72, 55];

export function TaggedUsageChartSkeleton() {
  return (
    <div aria-label="Loading tagged usage chart" className="h-full px-2 pb-1 pt-2" role="status">
      <span className="sr-only">Loading tagged usage chart...</span>
      <div className="flex h-[calc(100%-1.25rem)] gap-2">
        <div aria-hidden="true" className="flex w-7 shrink-0 flex-col justify-between py-1">
          {["w-5", "w-4", "w-5", "w-3", "w-4"].map((width, index) => (
            <Skeleton className={`h-2 ${width}`} key={index} />
          ))}
        </div>

        <div className="relative min-w-0 flex-1 border-b border-l border-line/70">
          <div aria-hidden="true" className="absolute inset-0 flex flex-col justify-between">
            {Array.from({ length: 5 }, (_, index) => (
              <span className="border-t border-line/60" key={index} />
            ))}
          </div>
          <div
            aria-hidden="true"
            className="absolute inset-x-2 bottom-0 top-1 flex items-end justify-around gap-1.5 sm:gap-3"
          >
            {barHeights.map((height, index) => (
              <div className="w-full max-w-8" key={index} style={{ height: `${height}%` }}>
                <Skeleton className="h-full w-full rounded-b-none opacity-80" />
              </div>
            ))}
          </div>
        </div>
      </div>

      <div aria-hidden="true" className="ml-9 mt-2 flex justify-around gap-3">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton className="h-2 w-8" key={index} />
        ))}
      </div>
    </div>
  );
}
