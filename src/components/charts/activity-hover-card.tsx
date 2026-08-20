import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowRight, Pencil } from "lucide-react";
import { DEFAULT_ACTIVITY_COLOR, activityTimeLabel, displayActivityTag } from "@/lib/activity-utils";
import { formatCurrency, formatKl, formatKwh } from "@/lib/format";
import type { ActivityReportRow } from "@/lib/types";
import { chartColors } from "./chart-config";

export type ActivityCardAnchor = {
  x: number;
  top: number;
};

export function ActivityHoverCard({
  activities,
  anchor,
  onEdit,
  onJumpToDay
}: {
  activities: ActivityReportRow[];
  anchor: ActivityCardAnchor;
  onEdit: (activity: ActivityReportRow) => void;
  onJumpToDay?: (activity: ActivityReportRow) => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number }>();

  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card) return;

    const placeCard = () => {
      const edgeGap = 8;
      const { width, height } = card.getBoundingClientRect();
      const viewport = window.visualViewport;
      const viewportLeft = viewport?.offsetLeft ?? 0;
      const viewportTop = viewport?.offsetTop ?? 0;
      const viewportRight = viewportLeft + (viewport?.width ?? window.innerWidth);
      const viewportBottom = viewportTop + (viewport?.height ?? window.innerHeight);
      setPosition({
        left: Math.max(viewportLeft + edgeGap, Math.min(anchor.x - width / 2, viewportRight - width - edgeGap)),
        top: Math.max(viewportTop + edgeGap, Math.min(anchor.top + edgeGap, viewportBottom - height - edgeGap))
      });
    };

    placeCard();
    window.addEventListener("resize", placeCard);
    window.visualViewport?.addEventListener("resize", placeCard);
    window.visualViewport?.addEventListener("scroll", placeCard);
    return () => {
      window.removeEventListener("resize", placeCard);
      window.visualViewport?.removeEventListener("resize", placeCard);
      window.visualViewport?.removeEventListener("scroll", placeCard);
    };
  }, [activities, anchor]);

  return createPortal(
    <div
      ref={cardRef}
      data-activity-card
      className="fixed z-50 max-h-[calc(100dvh-1rem)] w-max max-w-[min(16rem,calc(100vw-1rem))] overflow-y-auto rounded-md border border-line bg-paper/95 p-2 text-[0.7rem] shadow-soft sm:max-w-[min(18rem,calc(100vw-1rem))] sm:p-3 sm:text-xs"
      style={{
        left: position?.left ?? anchor.x,
        top: position?.top ?? anchor.top,
        visibility: position ? "visible" : "hidden"
      }}
    >
      {activities.map((activity, index) => (
        <div className={index ? "mt-2 border-t border-line pt-2" : ""} key={activity.id}>
          <div className="flex items-start justify-between gap-3">
            <p className="font-medium text-ink">{activityTimeLabel(activity)}</p>
            <button
              aria-label={`Edit ${activity.tags.map(displayActivityTag).join(", ")}`}
              className="-mr-1 -mt-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted transition hover:bg-canvas hover:text-ink"
              onClick={() => onEdit(activity)}
              type="button"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          </div>
          <p className="mt-0.5 flex items-center gap-1.5 text-muted sm:mt-1">
            <span
              aria-hidden="true"
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: activity.color ?? DEFAULT_ACTIVITY_COLOR }}
            />
            {activity.tags.map(displayActivityTag).join(", ")}
          </p>
          {activity.note ? <p className="mt-0.5 hidden text-muted sm:mt-1 sm:block">{activity.note}</p> : null}
          <div className="mt-1.5 space-y-0.5 text-muted sm:mt-2 sm:space-y-1">
            <div className="flex items-baseline justify-between gap-4">
              <span>Electricity</span>
              <span className="flex items-baseline gap-1 whitespace-nowrap text-right">
                <span style={{ color: chartColors.usage }}>{formatKwh(activity.electricityKwh)}</span>
                <span aria-hidden="true">·</span>
                <span style={{ color: chartColors.spend }}>{formatCurrency(activity.electricitySpend)}</span>
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-4">
              <span>Water</span>
              <span className="flex items-baseline gap-1 whitespace-nowrap text-right">
                <span style={{ color: chartColors.usage }}>{formatKl(activity.waterKl)}</span>
                <span aria-hidden="true">·</span>
                <span style={{ color: chartColors.spend }}>{formatCurrency(activity.waterSpend)}</span>
              </span>
            </div>
          </div>
          {onJumpToDay ? (
            <button
              className="group mt-1.5 flex items-center gap-1 text-brandTeal transition hover:brightness-110 dark:text-accent sm:mt-2"
              onClick={() => onJumpToDay(activity)}
              type="button"
            >
              Jump to day detail
              <ArrowRight aria-hidden="true" className="h-3 w-3 transition group-hover:translate-x-0.5" />
            </button>
          ) : null}
        </div>
      ))}
    </div>,
    document.body
  );
}
