"use client";

import { Maximize2, Minimize2, X, ZoomIn, ZoomOut } from "lucide-react";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type TouchEvent
} from "react";
import { Card } from "@/components/ui/card";
import { FullscreenDialog } from "@/components/ui/fullscreen-dialog";
import type { ChartShellProps } from "./types";

const minZoom = 1;
const maxZoom = 2.5;

function clampZoom(value: number) {
  return Math.min(maxZoom, Math.max(minZoom, value));
}

function touchDistance(touches: TouchEvent<HTMLDivElement>["touches"]) {
  const [first, second] = [touches[0], touches[1]];
  return Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY);
}

type ExpandContextValue = {
  isExpanded: boolean;
  expand: () => void;
  collapse: () => void;
};

const ExpandContext = createContext<ExpandContextValue | null>(null);

function useExpand() {
  const ctx = useContext(ExpandContext);
  if (!ctx) throw new Error("useExpand must be used within ExpandProvider");
  return ctx;
}

export function ExpandProvider({
  children,
  autoExpand = false,
  onCollapse
}: {
  children: ReactNode;
  autoExpand?: boolean;
  // Fires whenever this collapses, from any trigger (close button, escape,
  // backdrop click). Lets a caller that mounts this on demand (e.g. a
  // dialog-only chart) know to unmount/clear its own state, rather than
  // leaving something invisibly mounted that a repeat click can't reopen.
  onCollapse?: () => void;
}) {
  // autoExpand only matters at mount -- useState's initializer runs once,
  // so later prop changes don't fight a user who's since collapsed it
  // themselves.
  const [isExpanded, setIsExpanded] = useState(autoExpand);
  const value = useMemo(
    () => ({
      isExpanded,
      expand: () => setIsExpanded(true),
      collapse: () => {
        setIsExpanded(false);
        onCollapse?.();
      }
    }),
    [isExpanded, onCollapse]
  );
  return <ExpandContext.Provider value={value}>{children}</ExpandContext.Provider>;
}

export function ExpandChartButton() {
  const { expand } = useExpand();
  return (
    <button
      aria-label="Maximize chart"
      className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-line bg-paper text-ink transition hover:bg-canvas"
      onClick={expand}
      type="button"
    >
      <Maximize2 className="h-4 w-4" />
    </button>
  );
}

type IconButtonProps = {
  label: string;
  onClick: () => void;
  children: ReactNode;
  variant?: "default" | "dark";
};

function IconButton({ label, onClick, children, variant = "default" }: IconButtonProps) {
  const className =
    variant === "dark"
      ? "inline-flex h-9 w-9 items-center justify-center rounded-md bg-ink text-paper transition hover:opacity-90"
      : "inline-flex h-9 w-9 items-center justify-center rounded-md border border-line bg-paper text-ink transition hover:bg-canvas";

  return (
    <button aria-label={label} className={className} onClick={onClick} type="button">
      {children}
    </button>
  );
}

export function FullscreenChart({
  title,
  titleAdornment,
  action,
  children
}: {
  title: ReactNode;
  titleAdornment?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  const { isExpanded, collapse } = useExpand();
  const [zoom, setZoom] = useState(1);
  const pinchStart = useRef<{ distance: number; zoom: number } | null>(null);

  useEffect(() => {
    if (!isExpanded) {
      setZoom(1);
    }
  }, [isExpanded]);

  if (!isExpanded) return null;

  const updateZoom = (value: number) => setZoom(clampZoom(value));

  const handleTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    if (event.touches.length === 2) {
      pinchStart.current = { distance: touchDistance(event.touches), zoom };
    }
  };

  const handleTouchMove = (event: TouchEvent<HTMLDivElement>) => {
    if (event.touches.length !== 2 || !pinchStart.current) return;
    event.preventDefault();
    updateZoom((touchDistance(event.touches) / pinchStart.current.distance) * pinchStart.current.zoom);
  };

  return (
    <FullscreenDialog
      bodyClassName="min-h-0 flex-1 touch-pan-x touch-pan-y overflow-auto p-3 sm:p-5"
      closeButtonVariant="dark"
      closeIcon={X}
      closeLabel="Close chart"
      contentClassName="h-full"
      titleAdornment={titleAdornment}
      titleControls={
        <>
          <IconButton label="Zoom out" onClick={() => updateZoom(zoom - 0.25)}>
            <ZoomOut className="h-4 w-4" />
          </IconButton>
          <IconButton label="Fit chart" onClick={() => updateZoom(1)}>
            <Minimize2 className="h-4 w-4" />
          </IconButton>
          <IconButton label="Zoom in" onClick={() => updateZoom(zoom + 0.25)}>
            <ZoomIn className="h-4 w-4" />
          </IconButton>
        </>
      }
      headerAction={action}
      isOpen={isExpanded}
      onClose={collapse}
      panelClassName="max-w-none"
      title={title}
    >
      <div
        className="h-full min-h-[18rem] rounded-lg border border-line bg-paper p-3 shadow-soft sm:min-h-[24rem] sm:p-5"
        onTouchMove={handleTouchMove}
        onTouchStart={handleTouchStart}
        style={{ minWidth: "100%", width: `${Math.round(100 * zoom)}%` }}
      >
        {children}
      </div>
    </FullscreenDialog>
  );
}

function ChartShellInner({ title, titleAdornment, action, footer, fullScreenChildren, children }: ChartShellProps) {
  return (
    <>
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3.5 sm:px-5">
          <div className="flex min-w-0 items-baseline gap-2">
            <h2 className="text-base font-semibold text-ink">{title}</h2>
            {titleAdornment ? <span className="shrink-0 text-xs font-normal text-muted">{titleAdornment}</span> : null}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {action}
            <ExpandChartButton />
          </div>
        </div>
        <div className="h-64 px-1 py-4 sm:h-72 sm:px-4">{children}</div>
        {footer ? <div className="border-t border-line px-4 py-3 sm:px-5">{footer}</div> : null}
      </Card>
      <FullscreenChart title={title} titleAdornment={titleAdornment} action={action}>
        {fullScreenChildren ?? children}
      </FullscreenChart>
    </>
  );
}

export function ChartShell(props: ChartShellProps) {
  return (
    <ExpandProvider>
      <ChartShellInner {...props} />
    </ExpandProvider>
  );
}
