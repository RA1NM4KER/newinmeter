import type { CardHeaderProps, CardProps } from "./types";

export function Card({ children, className = "" }: CardProps) {
  return <section className={`min-w-0 rounded-lg border border-line bg-paper/88 ${className}`}>{children}</section>;
}

export function CardHeader({ title, action }: CardHeaderProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3.5 sm:px-5">
      <h2 className="min-w-0 truncate text-base font-semibold text-ink">{title}</h2>
      {action}
    </div>
  );
}
