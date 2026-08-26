import { Card } from "@/components/ui/card";
import type { AdoptionMetric, EngagementMetrics } from "@/lib/engagement";
import { StatTile } from "./stat-tile";

const adoptionLabels: Array<{ key: keyof EngagementMetrics["adoption"]; label: string; detail: string }> = [
  { key: "activities", label: "Activities", detail: "Created at least one Activity" },
  { key: "alertsEnabled", label: "Alerts enabled", detail: "Has at least one enabled Alert rule" },
  { key: "push", label: "Push", detail: "Has an active push subscription" },
  { key: "ai", label: "AI", detail: "Received at least one successful AI response" },
  { key: "livemopay", label: "LiveMopay", detail: "Has a current connected account" }
];

function AdoptionRow({
  label,
  detail,
  metric,
  total
}: {
  label: string;
  detail: string;
  metric: AdoptionMetric;
  total: number;
}) {
  return (
    <div className="flex items-center gap-4 border-t border-line px-4 py-3 first:border-t-0">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-ink">{label}</p>
        <p className="mt-0.5 text-xs text-muted">{detail}</p>
      </div>
      <div className="shrink-0 text-right tabular-nums">
        <p className="text-sm font-medium text-ink">
          {metric.users} / {total}
        </p>
        <p className="text-xs text-muted">{metric.percentage}%</p>
      </div>
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
            <p className="mt-1 text-xs text-muted">Distinct real users with durable product evidence</p>
          </div>
          <Card className="overflow-hidden">
            {adoptionLabels.map((item) => (
              <AdoptionRow
                detail={item.detail}
                key={item.key}
                label={item.label}
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
