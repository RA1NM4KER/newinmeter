import Link from "next/link";
import { AlertTriangle, CheckCircle2, ChevronDown, CircleAlert, RefreshCw } from "lucide-react";
import { AdminSectionTabs } from "./admin-section-tabs";
import type { DiagnosticConnection, DiagnosticsSnapshot, DiagnosticSyncRun } from "@/lib/diagnostics/data";
import type { HealthState } from "@/lib/diagnostics/health";

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

function when(value: string | null) {
  return value ? localDateTime.format(new Date(value)) : "Never";
}

function duration(value: number | null) {
  if (value === null) return "In progress";
  if (value < 1_000) return `${value} ms`;
  if (value < 60_000) return `${Math.round(value / 1_000)} sec`;
  return `${Math.round(value / 60_000)} min`;
}

const healthStyles: Record<HealthState, string> = {
  healthy:
    "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/70 dark:bg-emerald-950/40 dark:text-emerald-300",
  warning:
    "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/70 dark:bg-amber-950/40 dark:text-amber-300",
  critical: "border-red-200 bg-red-50 text-red-700 dark:border-red-900/70 dark:bg-red-950/40 dark:text-red-300"
};

function HealthPill({ state }: { state: HealthState }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold capitalize ${healthStyles[state]}`}
    >
      {state}
    </span>
  );
}

function OverviewCard({
  label,
  state,
  value,
  detail
}: {
  label: string;
  state?: HealthState;
  value: string;
  detail?: string;
}) {
  return (
    <div className="rounded-xl border border-line bg-paper p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">{label}</p>
        {state ? <HealthPill state={state} /> : null}
      </div>
      <p className="mt-2 text-xl font-semibold text-ink">{value}</p>
      {detail ? <p className="mt-1 text-xs leading-5 text-muted">{detail}</p> : null}
    </div>
  );
}

function RunHistory({ runs }: { runs: DiagnosticSyncRun[] }) {
  if (!runs.length) return <p className="text-sm text-muted">No capture runs recorded.</p>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[660px] text-left text-sm">
        <thead className="border-b border-line text-xs uppercase tracking-wide text-muted">
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
              <td className="max-w-sm py-2.5 text-muted">{run.error ?? run.rowsSynced ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ConnectionRow({ connection, selected }: { connection: DiagnosticConnection; selected: boolean }) {
  return (
    <details
      className="group scroll-mt-24 rounded-xl border border-line bg-paper"
      id={`connection-${connection.id}`}
      open={selected}
    >
      <summary className="flex cursor-pointer list-none items-center gap-3 p-4 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="truncate font-semibold text-ink">{connection.userEmail ?? "Unknown user"}</span>
            <HealthPill state={connection.health} />
          </span>
          <span className="mt-1 block truncate text-xs text-muted">
            {connection.accountLabel ?? "Unlabelled account"} · {connection.status.replace("_", " ")} ·{" "}
            {connection.healthReason}
          </span>
        </span>
        <span className="hidden text-right text-xs text-muted sm:block">
          Last success
          <span className="mt-0.5 block text-sm font-medium text-ink">{when(connection.lastSuccessfulSyncAt)}</span>
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted transition group-open:rotate-180" />
      </summary>

      <div className="border-t border-line px-4 pb-4 pt-3">
        <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <span className="block text-xs text-muted">Last attempt</span>
            <span className="text-ink">
              {when(connection.lastAttemptAt)}
              {connection.lastAttemptStatus ? ` · ${connection.lastAttemptStatus}` : ""}
            </span>
          </div>
          <div>
            <span className="block text-xs text-muted">Last auto-sync</span>
            <span className="text-ink">
              {when(connection.lastAutoSyncAt)}
              {connection.lastAutoSyncStatus ? ` · ${connection.lastAutoSyncStatus}` : ""}
            </span>
          </div>
          <div>
            <span className="block text-xs text-muted">Next scheduled</span>
            <span className="text-ink">{when(connection.nextSyncAt)}</span>
          </div>
          <div>
            <span className="block text-xs text-muted">Failure streak</span>
            <span className="text-ink">{connection.consecutiveFailures}</span>
          </div>
        </div>
        {connection.claimStuck || connection.lastAutoSyncError || connection.lastError ? (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-200">
            {connection.claimStuck ? "The scheduler claim is older than its expected lease. " : ""}
            {connection.lastAutoSyncError ?? connection.lastError ?? ""}
          </div>
        ) : null}
        <div className="mt-4">
          <h3 className="mb-2 text-sm font-semibold text-ink">Recent sync history</h3>
          <RunHistory runs={connection.recentRuns} />
        </div>
      </div>
    </details>
  );
}

export function DiagnosticsPage({
  snapshot,
  selectedConnectionId
}: {
  snapshot: DiagnosticsSnapshot;
  selectedConnectionId?: string;
}) {
  const { overview } = snapshot;

  return (
    <div className="flex flex-col gap-5 pb-10 pt-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">Admin</h1>
          <p className="mt-1 text-sm text-muted">System health, integration checks, and operational incidents.</p>
        </div>
        <Link
          className="inline-flex h-9 items-center gap-2 rounded-md border border-line bg-paper px-3 text-sm font-medium text-ink hover:bg-canvas"
          href="/admin/diagnostics"
        >
          <RefreshCw className="h-4 w-4" /> Refresh
        </Link>
      </div>

      <AdminSectionTabs activeId="diagnostics" />

      <section aria-labelledby="system-health-heading">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-muted" id="system-health-heading">
          System health
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <OverviewCard
            label="Overall"
            state={overview.overall}
            value={overview.overall === "healthy" ? "All systems normal" : "Attention required"}
            detail={`${overview.unresolvedCriticalEvents} unresolved critical event${overview.unresolvedCriticalEvents === 1 ? "" : "s"}`}
          />
          <OverviewCard
            label="LiveMopay API"
            state={overview.livemopay}
            value={overview.livemopay === "healthy" ? "Contract healthy" : "Contract check issue"}
            detail={`${overview.livemopayReason} Last check: ${when(overview.lastApiContractCheckAt)}`}
          />
          <OverviewCard
            label="Auto-sync scheduler"
            state={overview.scheduler}
            value={overview.scheduler === "healthy" ? "Worker on time" : "Worker delayed"}
            detail={`${overview.schedulerReason} Expected ~${overview.schedulerExpectedMinutes} min · Last: ${when(overview.schedulerLastInvocationAt)}`}
          />
          <OverviewCard
            label="Connections"
            value={`${overview.healthyConnections} / ${overview.connectionCount} healthy`}
            detail={`${overview.needsAttentionConnections} need attention`}
          />
          <OverviewCard
            label="Push delivery"
            state={overview.pushStatus ?? undefined}
            value={`${overview.activePushSubscriptions} active`}
            detail={overview.pushStatus ? "Latest operational delivery state." : "No delivery result recorded yet."}
          />
        </div>
      </section>

      <section aria-labelledby="connections-heading">
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-ink" id="connections-heading">
              Connection health
            </h2>
            <p className="text-sm text-muted">
              Real, non-demo current connections. Open a row for recent capture runs.
            </p>
          </div>
        </div>
        <div className="space-y-2">
          {snapshot.connections.length ? (
            snapshot.connections.map((connection) => (
              <ConnectionRow
                key={connection.id}
                connection={connection}
                selected={selectedConnectionId === connection.id}
              />
            ))
          ) : (
            <div className="rounded-xl border border-line bg-paper p-5 text-sm text-muted">
              No real LiveMopay connections found.
            </div>
          )}
        </div>
      </section>

      <section aria-labelledby="events-heading">
        <div className="mb-3">
          <h2 className="text-lg font-semibold text-ink" id="events-heading">
            Recent system events
          </h2>
          <p className="text-sm text-muted">
            Incidents and recoveries only; routine successful syncs remain in capture history.
          </p>
        </div>
        <div className="overflow-hidden rounded-xl border border-line bg-paper">
          {snapshot.events.length ? (
            <ul className="divide-y divide-line">
              {snapshot.events.map((event) => {
                const Icon =
                  event.severity === "critical"
                    ? CircleAlert
                    : event.severity === "warning"
                      ? AlertTriangle
                      : CheckCircle2;
                const content = (
                  <>
                    <Icon
                      className={`mt-0.5 h-4 w-4 shrink-0 ${event.severity === "critical" ? "text-red-600" : event.severity === "warning" ? "text-amber-600" : "text-emerald-600"}`}
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
                  <li id={`event-${event.id}`} key={event.id}>
                    {event.connectionId ? (
                      <Link
                        className="flex gap-3 p-3.5 transition hover:bg-canvas"
                        href={`/admin/diagnostics?connection=${encodeURIComponent(event.connectionId)}&event=${encodeURIComponent(event.id)}#connection-${encodeURIComponent(event.connectionId)}`}
                      >
                        {content}
                      </Link>
                    ) : (
                      <div className="flex gap-3 p-3.5">{content}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="p-5 text-sm text-muted">No system events recorded yet.</div>
          )}
        </div>
      </section>
    </div>
  );
}
