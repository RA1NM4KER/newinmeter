"use client";

import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { buildAdminEngagementUsersUrl } from "@/lib/endpoints";
import type { AdoptionMetric, AdoptionMetricKey, AdoptionMetricUser, EngagementMetrics } from "@/lib/engagement";
import { StatTile } from "./stat-tile";

const adoptionLabels: Array<{ key: AdoptionMetricKey; label: string; detail: string }> = [
  { key: "activities", label: "Activities", detail: "Created at least one Activity" },
  { key: "alertsEnabled", label: "Alerts enabled", detail: "Has at least one enabled Alert rule" },
  { key: "push", label: "Push", detail: "Has an active push subscription" },
  { key: "ai", label: "AI", detail: "Received at least one successful AI response" },
  { key: "livemopay", label: "LiveMopay", detail: "Has a current connected account" }
];

// Fetched only once a row is expanded, mirroring the Features tab's
// per-feature OverrideList, rather than bloating the page's initial metrics
// payload with every user's email up front.
function AdoptionUserList({ metricKey }: { metricKey: AdoptionMetricKey }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-engagement-users", metricKey],
    queryFn: async () => {
      const response = await fetch(buildAdminEngagementUsersUrl(metricKey), { cache: "no-store" });
      if (!response.ok) {
        const body = await response.text();
        throw new Error(body || "Failed to load users.");
      }
      return (await response.json()) as { users: AdoptionMetricUser[] };
    }
  });

  if (isLoading) {
    return <p className="text-xs text-muted">Loading…</p>;
  }
  if (error) {
    return <p className="text-xs text-red-600">Could not load users.</p>;
  }
  const users = data?.users ?? [];
  if (users.length === 0) {
    return <p className="text-xs text-muted">No one yet.</p>;
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {users.map((user) => (
        <span
          key={user.userId}
          className="inline-flex items-center rounded-full border border-line bg-canvas px-2.5 py-0.5 text-xs text-ink"
        >
          {user.email ?? user.userId}
        </span>
      ))}
    </div>
  );
}

function AdoptionRow({
  metricKey,
  label,
  detail,
  metric,
  total
}: {
  metricKey: AdoptionMetricKey;
  label: string;
  detail: string;
  metric: AdoptionMetric;
  total: number;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border-t border-line first:border-t-0">
      <button
        type="button"
        onClick={() => setExpanded((current) => !current)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-4 px-4 py-3 text-left transition hover:bg-canvas/60"
      >
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-ink">{label}</p>
          <p className="mt-0.5 text-xs text-muted">{detail}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className="text-right tabular-nums">
            <p className="text-sm font-medium text-ink">
              {metric.users} / {total}
            </p>
            <p className="text-xs text-muted">{metric.percentage}%</p>
          </div>
          <ChevronDown className={`h-4 w-4 text-muted transition-transform ${expanded ? "rotate-180" : ""}`} />
        </div>
      </button>

      {expanded ? (
        <div className="border-t border-line bg-canvas/40 px-4 py-3">
          <AdoptionUserList metricKey={metricKey} />
        </div>
      ) : null}
    </div>
  );
}

export function EngagementPanel({ metrics }: { metrics: EngagementMetrics }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto pb-5">
      <div className="flex flex-col gap-5">
        <section aria-labelledby="engagement-heading">
          <div className="mb-2.5 px-1">
            <h2 className="text-xs font-semibold tracking-wide text-muted" id="engagement-heading">
              Human activity
            </h2>
            <p className="mt-1 text-xs text-muted">Foreground app use only · SAST calendar days</p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
            <StatTile label="Real users" value={metrics.totalRealUsers} />
            <StatTile label="Today" value={metrics.activeToday} />
            <StatTile label="Last 7 days" value={metrics.activeLast7Days} />
            <StatTile label="Last 30 days" value={metrics.activeLast30Days} />
          </div>
        </section>

        <section aria-labelledby="adoption-heading">
          <div className="mb-2.5 px-1">
            <h2 className="text-xs font-semibold tracking-wide text-muted" id="adoption-heading">
              Feature adoption
            </h2>
            <p className="mt-1 text-xs text-muted">Distinct real users with durable product evidence · click a row for emails</p>
          </div>
          <Card className="overflow-hidden">
            {adoptionLabels.map((item) => (
              <AdoptionRow
                detail={item.detail}
                key={item.key}
                label={item.label}
                metricKey={item.key}
                metric={metrics.adoption[item.key]}
                total={metrics.totalRealUsers}
              />
            ))}
          </Card>
        </section>

        <p className="px-1 text-xs leading-relaxed text-muted">
          Admin, demo, and explicitly excluded system/test accounts are omitted. Engagement begins when this tracking is
          deployed; no historical activity is inferred from sign-ins or syncs.
        </p>
      </div>
    </div>
  );
}
