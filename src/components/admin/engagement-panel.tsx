"use client";

import { ChevronDown } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { buildAdminEngagementUsersUrl } from "@/lib/endpoints";
import type {
  ActivityWindowKey,
  AdoptionMetric,
  AdoptionMetricKey,
  AdoptionMetricUser,
  EngagementMetrics
} from "@/lib/engagement";
import { StatTile } from "./stat-tile";

const adoptionLabels: Array<{ key: AdoptionMetricKey; label: string; detail: string }> = [
  { key: "activities", label: "Activities", detail: "Created at least one Activity" },
  { key: "alertsEnabled", label: "Alerts enabled", detail: "Has at least one enabled Alert rule" },
  { key: "push", label: "Push", detail: "Has an active push subscription" },
  { key: "ai", label: "AI", detail: "Received at least one successful AI response" },
  { key: "livemopay", label: "LiveMopay", detail: "Has a current connected account" }
];

type PopoverRect = { top: number; left: number; width: number };

// Fetched only once a row is expanded, mirroring the Features tab's
// per-feature OverrideList, rather than bloating the page's initial metrics
// payload with every user's email up front. Shared by the adoption rows and
// the activity tiles below -- the API route dispatches on the same string
// key to either getAdoptionMetricUsers or getActivityWindowUsers.
function EngagementUserList({ metricKey }: { metricKey: AdoptionMetricKey | ActivityWindowKey }) {
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
          <EngagementUserList metricKey={metricKey} />
        </div>
      ) : null}
    </div>
  );
}

function ExpandableStatTile({
  label,
  value,
  metricKey
}: {
  label: string;
  value: number;
  metricKey: ActivityWindowKey;
}) {
  const [expanded, setExpanded] = useState(false);
  const [popoverRect, setPopoverRect] = useState<PopoverRect | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const popoverId = useId();
  const canExpand = value > 0;

  // This is a portal rather than an extension of the card: the dashboard
  // grid keeps its compact shape while the user list can float above the
  // content beneath it without being clipped by the scroll container.
  useLayoutEffect(() => {
    if (!expanded || !canExpand) {
      setPopoverRect(null);
      return;
    }

    const updateRect = () => {
      const rect = cardRef.current?.getBoundingClientRect();
      if (rect) setPopoverRect({ top: rect.bottom + 8, left: rect.left, width: rect.width });
    };

    updateRect();
    window.addEventListener("resize", updateRect);
    return () => window.removeEventListener("resize", updateRect);
  }, [canExpand, expanded]);

  useEffect(() => {
    if (!expanded || !canExpand) return;

    const closeWhenOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!cardRef.current?.contains(target) && !popoverRef.current?.contains(target)) setExpanded(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExpanded(false);
    };
    const closeOnScroll = (event: Event) => {
      // The list itself can scroll when there are many users. Only dismiss
      // when an ancestor/page scroll would leave the anchored popover stale.
      if (!popoverRef.current?.contains(event.target as Node)) setExpanded(false);
    };

    document.addEventListener("pointerdown", closeWhenOutside);
    document.addEventListener("keydown", closeOnEscape);
    window.addEventListener("scroll", closeOnScroll, true);
    return () => {
      document.removeEventListener("pointerdown", closeWhenOutside);
      document.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("scroll", closeOnScroll, true);
    };
  }, [canExpand, expanded]);

  const card = (
    <div className="flex-1" ref={cardRef}>
      <Card className={canExpand ? "" : "px-2 py-2 sm:px-4 sm:py-3"}>
        {canExpand ? (
          <button
            type="button"
            onClick={() => setExpanded((current) => !current)}
            aria-expanded={expanded}
            aria-controls={expanded ? popoverId : undefined}
            className="block w-full px-2 py-2 text-left sm:px-4 sm:py-3"
          >
            <span className="flex items-center gap-1">
              <span className="min-w-0 flex-1 truncate text-[0.6rem] uppercase tracking-[0.1em] text-muted sm:text-xs sm:tracking-[0.12em]">
                {label}
              </span>
              <ChevronDown
                className={`h-3 w-3 shrink-0 text-muted transition-transform ${expanded ? "rotate-180" : ""}`}
              />
            </span>
            <span className="mt-1 block text-lg font-semibold tabular-nums text-ink sm:text-2xl">{value}</span>
          </button>
        ) : (
          <>
            <p className="min-w-0 truncate text-[0.6rem] uppercase tracking-[0.1em] text-muted sm:text-xs sm:tracking-[0.12em]">
              {label}
            </p>
            <p className="mt-1 text-lg font-semibold tabular-nums text-ink sm:text-2xl">{value}</p>
          </>
        )}
      </Card>
    </div>
  );

  return (
    <>
      {card}
      {canExpand && expanded && popoverRect
        ? createPortal(
            <div
              aria-label={`${label} active users`}
              className="fixed z-[999] max-h-64 overflow-y-auto rounded-lg border border-line bg-paper p-3 shadow-soft"
              id={popoverId}
              ref={popoverRef}
              role="dialog"
              style={{ top: popoverRect.top, left: popoverRect.left, width: popoverRect.width }}
            >
              <p className="mb-2 text-xs font-medium text-ink">Active {label.toLowerCase()}</p>
              <EngagementUserList metricKey={metricKey} />
            </div>,
            document.body
          )
        : null}
    </>
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
          <div className="grid grid-cols-2 items-start gap-2 sm:grid-cols-4 sm:gap-3">
            <StatTile label="Real users" value={metrics.totalRealUsers} />
            <ExpandableStatTile label="Today" metricKey="today" value={metrics.activeToday} />
            <ExpandableStatTile label="Last 7 days" metricKey="last7Days" value={metrics.activeLast7Days} />
            <ExpandableStatTile label="Last 30 days" metricKey="last30Days" value={metrics.activeLast30Days} />
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
