import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { DaySummaryCardProps } from "./types";

export function DaySummaryCard({ label, value, href, detail, onClick }: DaySummaryCardProps) {
  const content = (
    <>
      <p className="text-xs leading-tight text-muted sm:text-sm">{label}</p>
      <p className="mt-2 text-lg font-semibold leading-tight text-ink sm:text-xl">{value}</p>
      {detail ? (
        <p className="mt-2 flex min-w-0 max-w-full items-center gap-1 text-[11px] font-medium text-brandTeal sm:text-xs">
          <span className="min-w-0 break-words">{detail}</span>
          <ArrowRight aria-hidden="true" className="h-3 w-3 shrink-0 transition group-hover:translate-x-0.5" />
        </p>
      ) : null}
    </>
  );

  return href ? (
    <Link
      className="group min-w-0 rounded-lg border border-line bg-canvas p-3 transition hover:border-accent/50 hover:bg-accentSoft/40 sm:p-4"
      href={href}
    >
      {content}
    </Link>
  ) : onClick ? (
    <button
      className="group min-w-0 rounded-lg border border-line bg-canvas p-3 text-left transition hover:border-accent/50 hover:bg-accentSoft/40 sm:p-4"
      onClick={onClick}
      type="button"
    >
      {content}
    </button>
  ) : (
    <div className="min-w-0 rounded-lg border border-line bg-canvas p-3 sm:p-4">{content}</div>
  );
}
