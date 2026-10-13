"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { LifecycleIcon } from "./lifecycle-icon";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { DiagnosticsRefreshButton } from "./diagnostics-refresh-button";
import { Card } from "@/components/ui/card";
import type { DiagnosticConnection, DiagnosticsSnapshot, DiagnosticSyncRun } from "@/lib/diagnostics/data";
import { healthDotClass, worstHealthState, type HealthState } from "@/lib/diagnostics/health";

const localDateTime = new Intl.DateTimeFormat("en-ZA", {
  timeZone: "Africa/Johannesburg",
  dateStyle: "medium",
  timeStyle: "short"
});

const localTime = new Intl.DateTimeFormat("en-ZA", {
  timeZone: "Africa/Johannesburg",
  hour: "2-digit",
  minute: "2-digit"
});

const healthTextClass: Record<HealthState, string> = {
  healthy: "text-ink",
  warning: "text-amber-700 dark:text-amber-400",
  critical: "text-red-600 dark:text-red-400"
};

const dataStateLabel: Record<DiagnosticConnection["dataState"], string> = {
  warm: "Warm",
  hibernating: "Hibernating",
  cold: "Cold",
  restoring: "Restoring",
  restore_failed: "Restore failed"
};

const dataStateBadgeClass: Record<DiagnosticConnection["dataState"], string> = {
  warm: "",
  hibernating: "border-amber-200 bg-amberSoft text-amber-800 dark:border-amber-900/70 dark:text-amber-300",
  cold: "border-line bg-canvas text-muted",
  restoring: "border-amber-200 bg-amberSoft text-amber-800 dark:border-amber-900/70 dark:text-amber-300",
  restore_failed: "border-red-200 bg-red-50 text-red-700 dark:border-red-900/70 dark:bg-red-950/40 dark:text-red-400"
};

function DataStateBadge({ connection }: { connection: DiagnosticConnection }) {
  if (connection.dataState === "warm") return null;
  return (
    <span
      className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[0.6875rem] font-medium ${dataStateBadgeClass[connection.dataState]}`}
    >
      {dataStateLabel[connection.dataState]}
    </span>
  );
}

function when(value: string | null) {
  return value ? localDateTime.format(new Date(value)) : "Never";
}

function duration(value: number | null) {
  if (value === null) return "In progress";
  if (value < 1_000) return `${value} ms`;
  if (value < 60_000) return `${Math.round(value / 1_000)} sec`;
  return `${Math.round(value / 60_000)} min`;
}

function StatusText({ state, label }: { state: HealthState; label?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${healthTextClass[state]}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${healthDotClass[state]}`} aria-hidden="true" />
      {label ?? `${state.charAt(0).toUpperCase()}${state.slice(1)}`}
    </span>
  );
}

function healthLabel(state: HealthState) {
  return `${state.charAt(0).toUpperCase()}${state.slice(1)}`;
}

function StatusRow({ label, value, description }: { label: string; value: React.ReactNode; description?: string }) {
  return (
    <div className="flex min-h-10 items-center justify-between gap-4 border-t border-line px-4 py-2.5">
      <span className="min-w-0 text-sm text-ink">
        {label}
        {description ? <span className="mt-0.5 block text-xs leading-snug text-muted">{description}</span> : null}
      </span>
      <span className="shrink-0 text-right">{value}</span>
    </div>
  );
}

function SectionLabel({ children, detail }: { children: React.ReactNode; detail?: React.ReactNode }) {
  return (
    <div className="mb-2.5 flex items-center justify-between gap-3 px-1">
      <h2 className="text-xs font-semibold tracking-wide text-muted">{children}</h2>
      {detail ? <span className="text-xs text-muted">{detail}</span> : null}
    </div>
  );
}

function RunHistory({ runs }: { runs: DiagnosticSyncRun[] }) {
  if (!runs.length) return <p className="text-xs text-muted">No capture runs recorded.</p>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[620px] text-left text-xs">
        <thead className="border-b border-line text-[0.6875rem] uppercase tracking-wide text-muted">
          <tr>
            <th className="py-2 pr-4 font-medium">Started</th>
            <th className="py-2 pr-4 font-medium">Source</th>
            <th className="py-2 pr-4 font-medium">Mode</th>
            <th className="py-2 pr-4 font-medium">Status</th>
            <th className="py-2 pr-4 font-medium">Duration</th>
            <th className="py-2 font-medium">Rows / error</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {runs.map((run) => (
            <tr key={run.id}>
              <td className="py-2.5 pr-4 text-ink">{when(run.startedAt)}</td>
              <td className="py-2.5 pr-4 capitalize text-muted">{run.trigger}</td>
              <td className="py-2.5 pr-4 capitalize text-muted">{run.mode}</td>
              <td className="py-2.5 pr-4 capitalize text-ink">{run.status}</td>
              <td className="py-2.5 pr-4 text-muted">{duration(run.durationMs)}</td>
              <td className="max-w-sm py-2.5 text-muted">
                {run.error ??
                  (run.rowsFetched != null
                    ? `${run.rowsFetched} fetched, ${run.rowsChanged ?? 0} changed`
                    : (run.rowsSynced ?? "—"))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

async function fetchDetails<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error("Could not load diagnostic details.");
  return response.json() as Promise<T>;
}

function DeferredDetails<T>({
  title,
  url,
  version,
  initiallyOpen = false,
  className = "group",
  compact = false,
  children
}: {
  title: string;
  url: string;
  version: string;
  initiallyOpen?: boolean;
  className?: string;
  compact?: boolean;
  children: (data: T) => ReactNode;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  useEffect(() => {
    if (initiallyOpen) setOpen(true);
  }, [initiallyOpen]);
  const query = useQuery({
    queryKey: ["diagnostic-details", url, version],
    queryFn: () => fetchDetails<T>(url),
    enabled: open,
    staleTime: 30_000
  });
  return (
    <details className={className} open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary
        className={`flex cursor-pointer list-none items-center gap-2 px-1 font-medium [&::-webkit-details-marker]:hidden ${compact ? "text-xs text-muted" : "text-sm text-ink"}`}
      >
        <span className="flex-1">{title}</span>
        <ChevronDown className="h-4 w-4 text-muted transition-transform group-open:rotate-180" />
      </summary>
      {open ? (
        query.isPending ? (
          <p className="px-4 py-3 text-xs text-muted" role="status">
            Loading details…
          </p>
        ) : query.isError ? (
          <button className="px-4 py-3 text-xs text-red-600" onClick={() => void query.refetch()}>
            Could not load details. Retry
          </button>
        ) : (
          children(query.data)
        )
      ) : null}
    </details>
  );
}

function ConnectionRow({
  connection: initialConnection,
  selected,
  deferred = false,
  version = ""
}: {
  connection: DiagnosticConnection;
  selected: boolean;
  deferred?: boolean;
  version?: string;
}) {
  const [open, setOpen] = useState(selected);
  useEffect(() => {
    if (selected) setOpen(true);
  }, [selected]);
  const query = useQuery({
    queryKey: ["diagnostic-connection", initialConnection.id, version],
    queryFn: () =>
      fetchDetails<DiagnosticConnection[]>(`/api/admin/diagnostics?section=connections&ids=${initialConnection.id}`),
    enabled: deferred && open,
    staleTime: 30_000
  });
  const connection = query.data?.[0] ?? initialConnection;
  return (
    <details
      className="group scroll-mt-4 border-t border-line first:border-t-0"
      id={`connection-${connection.id}`}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3.5 text-left transition hover:bg-canvas/60 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="truncate text-sm font-medium text-ink">{connection.userEmail ?? "Unknown user"}</span>
            <StatusText state={connection.health} />
            <DataStateBadge connection={connection} />
          </span>
          <span className="mt-0.5 block truncate text-xs text-muted">
            {connection.accountLabel ?? "Unlabelled account"} · {connection.status.replaceAll("_", " ")} ·{" "}
            {connection.healthReason}
          </span>
        </span>
        <span className="hidden shrink-0 text-right text-xs text-muted sm:block">
          Last success
          <span className="mt-0.5 block text-ink">{when(connection.lastSuccessfulSyncAt)}</span>
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted transition-transform group-open:rotate-180" />
      </summary>

      {deferred && query.isPending ? (
        open ? (
          <p className="px-4 py-3 text-xs text-muted" role="status">
            Loading details…
          </p>
        ) : null
      ) : deferred && query.isError ? (
        <button className="px-4 py-3 text-xs text-red-600" onClick={() => void query.refetch()}>
          Could not load details. Retry
        </button>
      ) : (
        <div className="border-t border-line bg-canvas/35 px-4 pb-4 pt-3">
          <div className="grid gap-x-5 gap-y-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <span className="block text-muted">Last successful sync</span>
              <span className="text-ink">{when(connection.lastSuccessfulSyncAt)}</span>
            </div>
            <div>
              <span className="block text-muted">Last attempt</span>
              <span className="text-ink">
                {when(connection.lastAttemptAt)}
                {connection.lastAttemptStatus ? ` · ${connection.lastAttemptStatus}` : ""}
              </span>
            </div>
            <div>
              <span className="block text-muted">Last auto-sync</span>
              <span className="text-ink">
                {when(connection.lastAutoSyncAt)}
                {connection.lastAutoSyncStatus ? ` · ${connection.lastAutoSyncStatus}` : ""}
              </span>
            </div>
            <div>
              <span className="block text-muted">Next scheduled</span>
              <span className="text-ink">{when(connection.nextSyncAt)}</span>
            </div>
            {connection.reporting ? (
              <div className="col-span-2">
                <span className="block text-muted">Reporting schedule · {connection.reporting.mode}</span>
                <span className="text-ink">{connection.reporting.reason}</span>
                <span className="block text-muted">
                  Electricity confidence {Math.round(connection.reporting.energyConfidence * 100)}%, water{" "}
                  {Math.round(connection.reporting.waterConfidence * 100)}%
                </span>
                <span className="block text-ink">
                  Latest upstream publication: {when(connection.reporting.latestPublicationAt)}
                </span>
                <span className="block text-ink">Predicted next fetch: {when(connection.reporting.predictedAt)}</span>
              </div>
            ) : null}
            {connection.dataState !== "warm" ? (
              <div>
                <span className="block text-muted">Data lifecycle</span>
                <span className="text-ink">
                  {dataStateLabel[connection.dataState]}
                  {connection.dataState === "cold" && connection.coldAt ? ` since ${when(connection.coldAt)}` : ""}
                  {connection.dataState === "restoring" && connection.restoreStartedAt
                    ? ` since ${when(connection.restoreStartedAt)}`
                    : ""}
                </span>
              </div>
            ) : null}
          </div>

          {connection.claimStuck || connection.lastAutoSyncError || connection.lastError ? (
            <p className="mt-3 rounded-md border border-amber-200 bg-amberSoft px-3 py-2 text-xs text-amber-800 dark:border-amber-900/70 dark:text-amber-300">
              {connection.claimStuck ? "The scheduler claim is older than its expected lease. " : ""}
              {connection.lastAutoSyncError ?? connection.lastError ?? ""}
            </p>
          ) : null}

          {connection.hibernationError || connection.restoreError ? (
            <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/70 dark:bg-red-950/40 dark:text-red-400">
              {connection.hibernationError ? `Cold-storage purge error: ${connection.hibernationError} ` : ""}
              {connection.restoreError ? `Restore error: ${connection.restoreError}` : ""}
            </p>
          ) : null}

          <div className="mt-4">
            <h3 className="mb-2 text-xs font-medium text-ink">
              Recent sync history · {connection.consecutiveFailures} consecutive failure
              {connection.consecutiveFailures === 1 ? "" : "s"}
            </h3>
            <RunHistory runs={connection.recentRuns} />
          </div>
        </div>
      )}
    </details>
  );
}

type DiagnosticEvent = DiagnosticsSnapshot["events"][number];

function EventRow({ event, selected }: { event: DiagnosticEvent; selected: boolean }) {
  const content = (
    <>
      <span
        className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${event.severity === "critical" ? "bg-red-500" : event.severity === "warning" ? "bg-amber-500" : "bg-accent"}`}
        aria-hidden="true"
      />
      <span className="min-w-0 flex-1">
        <span className="block text-sm text-ink">{event.message}</span>
        <span className="mt-0.5 block text-xs capitalize text-muted">
          {localTime.format(new Date(event.createdAt))} · {event.category}
          {event.resolvedAt ? " · resolved" : ""}
        </span>
      </span>
    </>
  );

  return (
    <li
      className={`border-t border-line first:border-t-0 ${selected ? "bg-accentSoft/50" : ""}`}
      id={`event-${event.id}`}
    >
      {event.connectionId ? (
        <Link
          className="flex gap-3 px-4 py-3 transition hover:bg-canvas/60"
          href={`/admin/diagnostics?connection=${encodeURIComponent(event.connectionId)}&event=${encodeURIComponent(event.id)}#connection-${encodeURIComponent(event.connectionId)}`}
          scroll={false}
        >
          {content}
        </Link>
      ) : (
        <div className="flex gap-3 px-4 py-3">{content}</div>
      )}
    </li>
  );
}

export function DiagnosticsPage({
  snapshot,
  selectedConnectionId,
  selectedEventId,
  deferredDetails = false
}: {
  snapshot: DiagnosticsSnapshot;
  selectedConnectionId?: string;
  selectedEventId?: string;
  deferredDetails?: boolean;
}) {
  const { overview } = snapshot;
  const problems = snapshot.connections.filter((connection) => connection.health !== "healthy");
  const healthyConnections = snapshot.connections.filter((connection) => connection.health === "healthy");
  const connectionState = worstHealthState(snapshot.connections.map((connection) => connection.health));
  const unresolvedEvents = snapshot.events.filter((event) => !event.resolvedAt);
  const resolvedEvents = snapshot.events.filter((event) => event.resolvedAt);
  const selectedHealthyConnection = healthyConnections.some((connection) => connection.id === selectedConnectionId);
  const selectedResolvedEvent = resolvedEvents.some((event) => event.id === selectedEventId);
  const overallLabel =
    overview.overall === "healthy"
      ? "All systems operational"
      : overview.overall === "warning"
        ? "System needs attention"
        : "Action required";

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="flex flex-col gap-5 pb-5">
        <Card className="overflow-hidden">
          <div className="flex items-center gap-3 px-4 py-3.5">
            <span className={`h-2 w-2 shrink-0 rounded-full ${healthDotClass[overview.overall]}`} aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-ink">{overallLabel}</p>
              <p className="mt-0.5 text-xs text-muted">Status evaluated just now</p>
            </div>
            <DiagnosticsRefreshButton />
          </div>
          <StatusRow
            description={overview.livemopay === "healthy" ? undefined : overview.livemopayReason}
            label="LiveMopay API"
            value={<StatusText state={overview.livemopay} />}
          />
          <StatusRow
            description={overview.scheduler === "healthy" ? undefined : overview.schedulerReason}
            label="Auto-sync"
            value={<StatusText state={overview.scheduler} />}
          />
          <StatusRow
            label="Connections"
            value={
              <StatusText
                state={connectionState}
                label={`${overview.healthyConnections} / ${overview.connectionCount} healthy`}
              />
            }
          />
          <StatusRow
            label="Data lifecycle"
            value={
              <span className="inline-flex flex-wrap items-center gap-x-1 text-xs text-muted">
                <span className="inline-flex items-center gap-1.5">
                  <LifecycleIcon lifecycle="active" />
                  {snapshot.connections.filter((connection) => connection.lifecycle === "active").length} active
                </span>
                {" · "}
                <span className="inline-flex items-center gap-1.5">
                  <LifecycleIcon lifecycle="paused" />
                  {snapshot.connections.filter((connection) => connection.lifecycle === "paused").length} paused
                </span>
                {" · "}
                <span className="inline-flex items-center gap-1.5">
                  <LifecycleIcon lifecycle="cold" />
                  {overview.coldConnections} cold
                </span>
                {overview.hibernatingConnections ? ` · ${overview.hibernatingConnections} hibernating` : ""}
                {overview.restoringConnections ? ` · ${overview.restoringConnections} restoring` : ""}
                {overview.restoreFailedConnections ? ` · ${overview.restoreFailedConnections} restore failed` : ""}
              </span>
            }
          />
          <StatusRow
            label="Tariff profile"
            value={
              <span
                className={`text-xs ${overview.tariffProfileMissingCount > 0 ? "text-amber-700 dark:text-amber-400" : "text-muted"}`}
              >
                {overview.tariffProfileMissingCount > 0
                  ? `${overview.tariffProfileMissingCount} connected Newinbosch account${overview.tariffProfileMissingCount === 1 ? "" : "s"} missing a profile`
                  : "None missing"}
              </span>
            }
          />
          <StatusRow
            label="Push"
            value={
              overview.pushStatus ? (
                <StatusText
                  state={overview.pushStatus}
                  label={`${healthLabel(overview.pushStatus)} · ${overview.activePushSubscriptions} active`}
                />
              ) : (
                <span className="text-xs text-muted">Not checked</span>
              )
            }
          />
        </Card>

        <section aria-labelledby="needs-attention-heading">
          <SectionLabel detail={`${problems.length} connection${problems.length === 1 ? "" : "s"}`}>
            <span id="needs-attention-heading">Connections needing attention</span>
          </SectionLabel>
          {problems.length ? (
            <Card className="overflow-hidden">
              {problems.map((connection) => (
                <ConnectionRow
                  connection={connection}
                  key={connection.id}
                  selected={selectedConnectionId === connection.id}
                  deferred={deferredDetails}
                  version={snapshot.generatedAt}
                />
              ))}
            </Card>
          ) : (
            <p className="px-1 text-sm text-muted">All connections are healthy.</p>
          )}
        </section>

        <section aria-labelledby="connections-heading">
          <SectionLabel detail={`${overview.healthyConnections} healthy · ${overview.connectionCount} total`}>
            <span id="connections-heading">Connections</span>
          </SectionLabel>
          {healthyConnections.length ? (
            deferredDetails ? (
              <DeferredDetails<DiagnosticConnection[]>
                title="View all healthy connections"
                version={snapshot.generatedAt}
                url={`/api/admin/diagnostics?section=connections&ids=${healthyConnections.map((connection) => connection.id).join(",")}&details=false`}
                initiallyOpen={selectedHealthyConnection}
              >
                {(connections) => (
                  <Card className="mt-2 overflow-hidden">
                    {connections.map((connection) => (
                      <ConnectionRow
                        key={connection.id}
                        connection={connection}
                        selected={selectedConnectionId === connection.id}
                        deferred
                        version={snapshot.generatedAt}
                      />
                    ))}
                  </Card>
                )}
              </DeferredDetails>
            ) : (
              <details className="group" open={selectedHealthyConnection}>
                <summary className="flex cursor-pointer list-none items-center gap-2 px-1 text-sm font-medium text-ink [&::-webkit-details-marker]:hidden">
                  <span className="flex-1">View all healthy connections</span>
                  <ChevronDown className="h-4 w-4 text-muted transition-transform group-open:rotate-180" />
                </summary>
                <Card className="mt-2 overflow-hidden">
                  {healthyConnections.map((connection) => (
                    <ConnectionRow
                      connection={connection}
                      key={connection.id}
                      selected={selectedConnectionId === connection.id}
                    />
                  ))}
                </Card>
              </details>
            )
          ) : (
            <p className="px-1 text-sm text-muted">No healthy connections.</p>
          )}
        </section>

        <section aria-labelledby="incidents-heading">
          <SectionLabel detail={`${unresolvedEvents.length} unresolved`}>
            <span id="incidents-heading">Recent incidents</span>
          </SectionLabel>
          {unresolvedEvents.length ? (
            <Card className="overflow-hidden">
              <ul>
                {unresolvedEvents.map((event) => (
                  <EventRow event={event} key={event.id} selected={event.id === selectedEventId} />
                ))}
              </ul>
            </Card>
          ) : (
            <p className="px-1 text-sm text-muted">No unresolved incidents.</p>
          )}

          {deferredDetails ? (
            <DeferredDetails<DiagnosticsSnapshot["events"]>
              title="View recent resolved events"
              className="group mt-3"
              compact
              version={snapshot.generatedAt}
              url="/api/admin/diagnostics?section=resolved"
              initiallyOpen={Boolean(
                selectedEventId && !unresolvedEvents.some((event) => event.id === selectedEventId)
              )}
            >
              {(events) =>
                events.length ? (
                  <Card className="mt-2 overflow-hidden">
                    <ul>
                      {events.map((event) => (
                        <EventRow key={event.id} event={event} selected={event.id === selectedEventId} />
                      ))}
                    </ul>
                  </Card>
                ) : (
                  <p className="px-4 py-3 text-xs text-muted">No recent resolved incidents.</p>
                )
              }
            </DeferredDetails>
          ) : resolvedEvents.length ? (
            <details className="group mt-3" open={selectedResolvedEvent}>
              <summary className="flex cursor-pointer list-none items-center gap-2 px-1 text-xs text-muted [&::-webkit-details-marker]:hidden">
                <span className="flex-1">View recent resolved events</span>
                <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
              </summary>
              <Card className="mt-2 overflow-hidden">
                <ul>
                  {resolvedEvents.map((event) => (
                    <EventRow event={event} key={event.id} selected={event.id === selectedEventId} />
                  ))}
                </ul>
              </Card>
            </details>
          ) : null}
        </section>
      </div>
    </div>
  );
}
