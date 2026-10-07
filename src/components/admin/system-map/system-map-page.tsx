"use client";

import { useCallback, useId, useState } from "react";
import Link from "next/link";
import {
  Activity,
  ArrowRight,
  KeyRound,
  Layers,
  Bell,
  Send,
  Monitor,
  Clock3,
  RefreshCw,
  Network,
  List,
  ExternalLink
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { SYSTEM_NODES, SYSTEM_EDGES, MAP_WIDTH, MAP_HEIGHT, NODE_WIDTH, NODE_HEIGHT } from "@/lib/system-map/topology";
import type { MapHealth, Observation, SystemMapSnapshot } from "@/lib/system-map/model";
import { LiveMopayIcon, OpenAIIcon, SupabaseIcon } from "./brand-icons";
import { useSystemMap } from "./use-system-map";
import { SystemMapSkeleton } from "./system-map-skeleton";

const icons = {
  livemopay: LiveMopayIcon,
  session: KeyRound,
  scheduler: Clock3,
  sync: RefreshCw,
  database: SupabaseIcon,
  rollups: Layers,
  alerts: Bell,
  push: Send,
  client: Monitor,
  auth: KeyRound,
  ai: OpenAIIcon,
  cron: Clock3
};
const labels: Record<MapHealth, string> = {
  healthy: "Healthy",
  degraded: "Degraded",
  failed: "Failed",
  unknown: "Unknown",
  affected: "Affected"
};
const colors: Record<MapHealth, string> = {
  healthy: "text-success",
  degraded: "text-amber-700 dark:text-amber-400",
  failed: "text-red-600 dark:text-red-400",
  unknown: "text-muted",
  affected: "text-violet-700 dark:text-violet-400"
};
const backgrounds: Record<MapHealth, string> = {
  healthy: "bg-accentSoft",
  degraded: "bg-amberSoft",
  failed: "bg-roseSoft",
  unknown: "bg-canvas",
  affected: "bg-violet-50 dark:bg-violet-950/40"
};
const dateFormat = new Intl.DateTimeFormat("en-ZA", {
  timeZone: "Africa/Johannesburg",
  dateStyle: "medium",
  timeStyle: "short"
});
function when(value: string | null) {
  return value ? dateFormat.format(new Date(value)) : "Not recorded";
}
function nodeName(id: string) {
  return SYSTEM_NODES.find((node) => node.id === id)?.label ?? id;
}
// Nodes with no telemetry source are never going to report, so they read "Not
// monitored" instead of a pending-looking "Unknown".
function isUnmonitored(id: string) {
  return SYSTEM_NODES.find((node) => node.id === id)?.source === "unknown";
}
function Status({ status, unmonitored = false }: { status: MapHealth | "unmonitored"; unmonitored?: boolean }) {
  const display = unmonitored ? "unmonitored" : status;
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs font-medium ${display === "unmonitored" ? "text-muted" : colors[display]}`}
    >
      <span
        aria-hidden="true"
        className={`h-1.5 w-1.5 ${display === "unknown" ? "border border-current" : display === "unmonitored" ? "border border-dashed border-current" : "bg-current"} ${display === "affected" ? "rotate-45 rounded-sm" : "rounded-full"}`}
      />
      {display === "unmonitored" ? "Not monitored" : labels[display]}
    </span>
  );
}

type Selection = { kind: "node" | "edge"; id: string };

function Inspector({
  selection,
  snapshot,
  stale,
  close
}: {
  selection: Selection | null;
  snapshot: SystemMapSnapshot;
  stale: boolean;
  close: () => void;
}) {
  const definition =
    selection?.kind === "node"
      ? SYSTEM_NODES.find((node) => node.id === selection.id)
      : SYSTEM_EDGES.find((edge) => edge.id === selection?.id);
  const observation = selection ? (selection.kind === "node" ? snapshot.nodes : snapshot.edges)[selection.id] : null;
  return (
    <Dialog
      isOpen={!!definition && !!observation}
      onClose={close}
      dismissOnBackdrop
      title={definition?.label ?? "System details"}
      eyebrow={selection?.kind === "edge" ? "Connection details" : "Component details"}
    >
      {definition && observation ? (
        <div className="space-y-5">
          <div className="flex items-center justify-between gap-3">
            <Status
              status={stale ? "unknown" : observation.status}
              unmonitored={selection?.kind === "node" && isUnmonitored(definition.id)}
            />
            <span className="text-xs text-muted">{stale ? "Snapshot stale" : "Latest available evidence"}</span>
          </div>
          <p className="text-sm leading-relaxed text-ink">{definition.description}</p>
          <div
            className={`rounded-lg p-3 text-sm leading-relaxed ${backgrounds[stale ? "unknown" : observation.status]}`}
          >
            {stale
              ? "Current health is unknown because this snapshot could not be refreshed. The evidence below is retained for reference."
              : observation.reason}
          </div>
          {observation.affectedBy.length ? (
            <div className="rounded-lg border border-violet-200 p-3 text-sm dark:border-violet-900">
              <p className="font-medium text-ink">Possible upstream impact</p>
              <p className="mt-1 text-muted">
                {observation.affectedBy.map(nodeName).join(", ")} has a recorded failure. This dependency may be
                affected; the map does not establish the cause of its own symptoms.
              </p>
            </div>
          ) : null}
          <dl className="grid grid-cols-2 gap-4 text-xs">
            {[
              ["Last observation", observation.observedAt],
              ["Last success", observation.lastSuccessAt],
              ["Last recorded failure", observation.lastFailureAt],
              ["Snapshot collected", snapshot.generatedAt]
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-muted">{label}</dt>
                <dd className="mt-1 font-medium text-ink">{when(value)}</dd>
              </div>
            ))}
          </dl>
          <p className="text-[11px] text-muted">
            Times shown in Africa/Johannesburg. Missing timestamps mean no evidence was recorded, not that no failure
            occurred.
          </p>
          {observation.metrics.length ? (
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Evidence & metrics</h3>
              <dl className="divide-y divide-line">
                {observation.metrics.map((metric) => (
                  <div key={metric.label} className="flex justify-between gap-4 py-2 text-xs">
                    <dt className="text-muted">{metric.label}</dt>
                    <dd className="max-w-[55%] text-right font-medium text-ink">{metric.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : null}
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Relevant diagnostics</h3>
            {observation.events.length ? (
              <ul className="space-y-3">
                {observation.events.map((event) => (
                  <li key={event.id} className="border-l-2 border-line pl-3">
                    <Link
                      className="text-sm text-ink underline decoration-line underline-offset-4 hover:decoration-ink"
                      href={`/admin/diagnostics?event=${encodeURIComponent(event.id)}`}
                    >
                      {event.message}
                    </Link>
                    <p className="mt-1 text-xs text-muted">
                      {when(event.createdAt)} ·{" "}
                      {event.resolvedAt ? "Resolved" : event.severity === "info" ? "Information" : "Unresolved"}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted">
                No relevant events in the available evidence. This alone does not confirm health.
              </p>
            )}
          </div>
          <Link
            href="/admin/diagnostics"
            className="inline-flex items-center gap-2 rounded-md border border-line px-3 py-2 text-sm font-medium text-ink hover:bg-canvas"
          >
            Open Diagnostics <ExternalLink className="h-3.5 w-3.5" />
          </Link>
        </div>
      ) : null}
    </Dialog>
  );
}

function MapDiagram({
  snapshot,
  stale,
  select
}: {
  snapshot: SystemMapSnapshot;
  stale: boolean;
  select: (selection: Selection) => void;
}) {
  const markerId = useId().replaceAll(":", "");
  return (
    <div className="overflow-x-auto" role="region" aria-label="System architecture map" tabIndex={0}>
      <div className="relative min-w-[1000px]" style={{ aspectRatio: `${MAP_WIDTH} / ${MAP_HEIGHT}` }}>
        <svg
          className="absolute inset-0 h-full w-full"
          viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`}
          aria-label="Operational dependencies"
        >
          <defs>
            <marker
              id={markerId}
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="5"
              markerHeight="5"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" />
            </marker>
          </defs>
          <text x="30" y="38" className="fill-muted text-[11px] font-medium tracking-[2px]">
            SOURCE
          </text>
          <text x="270" y="38" className="fill-muted text-[11px] font-medium tracking-[2px]">
            INGESTION
          </text>
          <text x="510" y="38" className="fill-muted text-[11px] font-medium tracking-[2px]">
            DATA
          </text>
          <text x="990" y="38" className="fill-muted text-[11px] font-medium tracking-[2px]">
            EXPERIENCE
          </text>
          {SYSTEM_EDGES.map((edge) => {
            const status = stale ? "unknown" : snapshot.edges[edge.id].status;
            return (
              <g
                key={edge.id}
                className={`cursor-pointer outline-none ${colors[status]} [&:focus-visible>.edge-line]:stroke-[4] [&:hover>.edge-line]:stroke-[3]`}
                role="button"
                tabIndex={0}
                aria-label={`${edge.label}: ${nodeName(edge.from)} to ${nodeName(edge.to)}, ${labels[status]}`}
                onClick={() => select({ kind: "edge", id: edge.id })}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    select({ kind: "edge", id: edge.id });
                  }
                }}
              >
                <title>{edge.label}</title>
                <path d={edge.path} fill="none" stroke="transparent" strokeWidth="18" />
                <path
                  className="edge-line"
                  d={edge.path}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeDasharray={edge.kind === "control" ? "5 5" : undefined}
                  markerEnd={`url(#${markerId})`}
                />
              </g>
            );
          })}
          <text x="840" y="116" textAnchor="middle" className="fill-muted text-[11px]">
            Read through app APIs
          </text>
        </svg>
        {SYSTEM_NODES.map((node) => {
          const observation = snapshot.nodes[node.id];
          const status = stale ? "unknown" : observation.status;
          const Icon = icons[node.id];
          return (
            <button
              key={node.id}
              type="button"
              onClick={() => select({ kind: "node", id: node.id })}
              aria-label={`${node.label}, ${isUnmonitored(node.id) ? "Not monitored" : labels[status]}${observation.affectedBy.length ? ", possible upstream impact" : ""}`}
              className="absolute flex flex-col justify-center rounded-lg border border-line bg-paper px-3 text-left shadow-sm transition hover:border-muted hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              style={{
                left: `${(node.x / MAP_WIDTH) * 100}%`,
                top: `${(node.y / MAP_HEIGHT) * 100}%`,
                width: `${(NODE_WIDTH / MAP_WIDTH) * 100}%`,
                height: `${(NODE_HEIGHT / MAP_HEIGHT) * 100}%`
              }}
            >
              <span className="mb-1 flex items-center gap-2 text-xs font-semibold text-ink">
                <Icon className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden="true" />
                {node.label}
              </span>
              <span className="mb-2 block text-[10px] text-muted">{node.subtitle}</span>
              <Status status={status} unmonitored={isUnmonitored(node.id)} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function SystemMapPage({ initialSnapshot }: { initialSnapshot: SystemMapSnapshot | null }) {
  const { snapshot, refreshing, error, refresh, stale } = useSystemMap(initialSnapshot);
  const [view, setView] = useState<"map" | "list">("map");
  const [selection, setSelection] = useState<Selection | null>(null);
  const close = useCallback(() => setSelection(null), []);
  const statusOf = (observation: Observation): MapHealth => (stale ? "unknown" : observation.status);
  const counts = snapshot
    ? Object.entries(snapshot.nodes).reduce(
        (result, [id, observation]) => {
          result[isUnmonitored(id) ? "unmonitored" : statusOf(observation)] += 1;
          return result;
        },
        { healthy: 0, degraded: 0, failed: 0, affected: 0, unknown: 0, unmonitored: 0 }
      )
    : null;

  if (!snapshot && !error) return <SystemMapSkeleton />;

  const refreshButton = (
    <button
      type="button"
      onClick={() => void refresh()}
      disabled={refreshing}
      aria-label={refreshing ? "Refreshing" : "Refresh"}
      title="Refresh"
      className="rounded p-1.5 text-muted hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50"
    >
      <RefreshCw className={`h-4 w-4 ${refreshing ? "motion-safe:animate-spin" : ""}`} aria-hidden="true" />
    </button>
  );

  return (
    <div className="min-h-0 flex-1 overflow-y-auto pb-6">
      <div aria-live="polite" className="mb-4">
        {error || stale ? (
          <p role="status" className="rounded-lg border border-amber-200 bg-amberSoft px-4 py-3 text-sm text-ink">
            {error ??
              "This snapshot is over two minutes old. Current health is unknown until the next successful refresh."}
          </p>
        ) : null}
      </div>
      {!snapshot ? (
        <Card className="p-8 text-center">
          <Activity className="mx-auto mb-3 h-7 w-7 text-muted" />
          <h3 className="font-medium text-ink">Health data is unavailable</h3>
          <div className="mt-2 flex justify-center">{refreshButton}</div>
          <p className="mt-2 text-sm text-muted">
            {refreshing
              ? "Checking the diagnostics service…"
              : "Use Refresh to try again. The map will appear when evidence is available."}
          </p>
        </Card>
      ) : (
        <>
          <ul aria-label="Component health summary" className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1.5">
            {/* Problems lead; zero counts are omitted so the line only draws attention when needed. */}
            {(["failed", "degraded", "affected", "healthy", "unknown", "unmonitored"] as const)
              .filter((status) => counts?.[status])
              .map((status) => (
                <li key={status} className="inline-flex items-center gap-1.5">
                  <span className="text-sm font-semibold tabular-nums text-ink">{counts?.[status]}</span>
                  <Status
                    status={status === "unmonitored" ? "unknown" : status}
                    unmonitored={status === "unmonitored"}
                  />
                </li>
              ))}
          </ul>
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
              <div>
                <h3 className="text-sm font-semibold text-ink">Operational architecture</h3>
                <p className="mt-0.5 text-xs text-muted">Select a component or connection to inspect it.</p>
              </div>
              <div className="flex items-center gap-2">
                {refreshButton}
                <div className="hidden gap-1 rounded-md bg-canvas p-1 md:flex" aria-label="Map display">
                  {(["map", "list"] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      aria-pressed={view === mode}
                      onClick={() => setView(mode)}
                      className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1.5 text-xs ${view === mode ? "bg-paper font-medium text-ink shadow-sm" : "text-muted"}`}
                    >
                      {mode === "map" ? <Network className="h-3.5 w-3.5" /> : <List className="h-3.5 w-3.5" />}
                      {mode === "map" ? "Map" : "List"}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            {view === "map" ? (
              <div className="hidden bg-canvas/40 md:block">
                <MapDiagram snapshot={snapshot} stale={stale} select={setSelection} />
              </div>
            ) : null}
            <div
              className={`${view === "map" ? "md:hidden" : ""} grid gap-px bg-line sm:grid-cols-2 lg:grid-cols-3`}
              aria-label="System components"
            >
              {SYSTEM_NODES.map((node) => {
                const Icon = icons[node.id];
                return (
                  <button
                    key={node.id}
                    type="button"
                    onClick={() => setSelection({ kind: "node", id: node.id })}
                    className="flex items-start gap-3 bg-paper p-4 text-left hover:bg-canvas focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                  >
                    <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-ink">{node.label}</span>
                      <span className="mb-2 mt-0.5 block text-xs text-muted">{node.subtitle}</span>
                      <Status status={statusOf(snapshot.nodes[node.id])} unmonitored={isUnmonitored(node.id)} />
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-3 text-[11px] text-muted">
              <span>Solid arrows: data flow · Dashed arrows: control or scheduling</span>
              <span>Static paths; no simulated activity</span>
            </div>
          </Card>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
            <span>Collected {when(snapshot.generatedAt)} SAST</span>
            <span>Refreshes every 45 seconds while visible</span>
          </div>
          <details className="mt-5 rounded-lg border border-line bg-paper">
            <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-ink">
              Connections <span className="ml-1 text-muted">({SYSTEM_EDGES.length})</span>
            </summary>
            <div className="divide-y divide-line border-t border-line">
              {SYSTEM_EDGES.map((edge) => (
                <button
                  key={edge.id}
                  type="button"
                  onClick={() => setSelection({ kind: "edge", id: edge.id })}
                  className="flex w-full flex-wrap items-center justify-between gap-2 px-4 py-3 text-left hover:bg-canvas"
                >
                  <span>
                    <span className="flex items-center gap-1.5 text-xs font-medium text-ink">
                      {nodeName(edge.from)}
                      <ArrowRight className="h-3 w-3" aria-label="to" />
                      {nodeName(edge.to)}
                    </span>
                    <span className="mt-1 block text-xs text-muted">{edge.label}</span>
                  </span>
                  <Status status={statusOf(snapshot.edges[edge.id])} />
                </button>
              ))}
            </div>
          </details>
          <p className="mt-4 text-xs leading-relaxed text-muted">
            Unknown means telemetry is missing or too old. Affected marks a possible dependency impact, not an
            independently confirmed failure. A healthy observation covers only the check described in its details.
          </p>
          <Inspector selection={selection} snapshot={snapshot} stale={stale} close={close} />
        </>
      )}
    </div>
  );
}
