import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { MAP_HEIGHT, MAP_WIDTH, NODE_HEIGHT, NODE_WIDTH, SYSTEM_EDGES, SYSTEM_NODES } from "@/lib/system-map/topology";

export function SystemMapSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading system map" className="min-h-0 flex-1 overflow-y-auto pb-6">
      <span className="sr-only">Loading components and the latest health evidence.</span>
      <div aria-hidden="true">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold tracking-tight text-ink">System map</h2>
            <p className="mt-1 text-sm text-muted">Reading the latest health signals…</p>
          </div>
          <div className="flex h-8 items-center gap-2 rounded-md border border-line bg-paper px-3">
            <Skeleton className="h-3.5 w-3.5 rounded-full" />
            <Skeleton className="h-3 w-12" />
          </div>
        </div>
        <div className="mb-4 grid grid-cols-3 gap-2 sm:grid-cols-5">
          {Array.from({ length: 5 }, (_, index) => (
            <div key={index} className="rounded-lg border border-line bg-paper px-3 py-3">
              <Skeleton className="mb-2 h-6 w-7" />
              <div className="flex h-4 items-center gap-1.5">
                <Skeleton className="h-1.5 w-1.5 rounded-full" />
                <Skeleton className="h-3 w-14" />
              </div>
            </div>
          ))}
        </div>
        <Card>
          <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
            <div>
              <h3 className="text-sm font-semibold text-ink">Operational architecture</h3>
              <Skeleton className="mt-2 h-3 w-56 max-w-full" />
            </div>
            <div className="hidden gap-1 rounded-md bg-canvas p-1 md:flex">
              <Skeleton className="h-7 w-14" />
              <Skeleton className="h-7 w-14" />
            </div>
          </div>
          <div className="hidden overflow-x-auto bg-canvas/40 md:block">
            <div className="relative min-w-[1000px]" style={{ aspectRatio: `${MAP_WIDTH} / ${MAP_HEIGHT}` }}>
              <svg className="absolute inset-0 h-full w-full text-line" viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`}>
                {SYSTEM_EDGES.map((edge) => (
                  <path
                    key={edge.id}
                    d={edge.path}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeDasharray={edge.kind === "control" ? "5 5" : undefined}
                  />
                ))}
              </svg>
              {[30, 270, 510, 990].map((x) => (
                <div
                  key={x}
                  className="absolute"
                  style={{ left: `${(x / MAP_WIDTH) * 100}%`, top: `${(30 / MAP_HEIGHT) * 100}%` }}
                >
                  <Skeleton className="h-2.5 w-16" />
                </div>
              ))}
              {SYSTEM_NODES.map((node, index) => (
                <div
                  key={node.id}
                  className="absolute flex flex-col justify-center rounded-lg border border-line bg-paper px-3 shadow-sm"
                  style={{
                    left: `${(node.x / MAP_WIDTH) * 100}%`,
                    top: `${(node.y / MAP_HEIGHT) * 100}%`,
                    width: `${(NODE_WIDTH / MAP_WIDTH) * 100}%`,
                    height: `${(NODE_HEIGHT / MAP_HEIGHT) * 100}%`
                  }}
                >
                  <div className="mb-2 flex items-center gap-2">
                    <Skeleton className="h-3.5 w-3.5 shrink-0 rounded" />
                    <Skeleton className={`h-3 ${index % 2 ? "w-24" : "w-20"}`} />
                  </div>
                  <Skeleton className="mb-3 h-2 w-24 max-w-full" />
                  <div className="flex items-center gap-1.5">
                    <Skeleton className="h-1.5 w-1.5 rounded-full" />
                    <Skeleton className="h-2.5 w-12" />
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="grid gap-px bg-line sm:grid-cols-2 md:hidden">
            {SYSTEM_NODES.map((node, index) => (
              <div key={node.id} className="flex gap-3 bg-paper p-4">
                <Skeleton className="mt-0.5 h-4 w-4 shrink-0 rounded" />
                <div className="flex-1">
                  <Skeleton className={`h-4 ${index % 2 ? "w-36" : "w-28"}`} />
                  <Skeleton className="mb-3 mt-2 h-3 w-32" />
                  <div className="flex h-4 items-center gap-1.5">
                    <Skeleton className="h-1.5 w-1.5 rounded-full" />
                    <Skeleton className="h-3 w-14" />
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap justify-between gap-3 border-t border-line px-4 py-3">
            <Skeleton className="h-3 w-56" />
            <Skeleton className="h-3 w-32" />
          </div>
        </Card>
        <div className="mt-4 flex flex-wrap justify-between gap-3">
          <Skeleton className="h-3 w-44" />
          <Skeleton className="h-3 w-48" />
        </div>
        <div className="mt-5 rounded-lg border border-line bg-paper px-4 py-4">
          <Skeleton className="h-3 w-28" />
        </div>
      </div>
    </div>
  );
}
