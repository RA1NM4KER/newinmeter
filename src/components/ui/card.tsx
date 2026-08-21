import type { CardHeaderProps, CardProps } from "./types";

export function Card({ children, className = "" }: CardProps) {
  // bg-paper (full opacity), matching MetricCard's own card markup -- the
  // previous bg-paper/88 never actually compiled to a real CSS rule (Tailwind
  // never generated it, for reasons unclear), so every plain <Card> with no
  // background override in its own className was silently rendering with a
  // fully transparent fill this whole time -- border and rounded corners
  // only, no fill -- which is why some cards read as visually "unfinished"
  // rather than as an actual color mismatch.
  return <section className={`min-w-0 rounded-lg border border-line bg-paper ${className}`}>{children}</section>;
}

export function CardHeader({ title, action }: CardHeaderProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3.5 sm:px-5">
      <h2 className="min-w-0 truncate text-base font-semibold text-ink">{title}</h2>
      {action}
    </div>
  );
}
