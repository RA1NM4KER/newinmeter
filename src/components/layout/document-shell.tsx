import Link from "next/link";
import type { ReactNode } from "react";
import { Wordmark } from "./wordmark";

type DocumentShellProps = {
  title: string;
  updated: string;
  children: ReactNode;
};

export function DocumentShell({ title, updated, children }: DocumentShellProps) {
  return (
    <div className="min-h-screen bg-canvas">
      <header className="sticky top-0 z-20 border-b border-line bg-canvas/90 px-6 py-5 backdrop-blur">
        <Link href="/">
          <Wordmark className="text-xl" textClassName="text-ink" accentClassName="text-accent" />
        </Link>
      </header>

      <main className="mx-auto max-w-2xl px-6 py-12">
        <h1 className="text-3xl font-semibold tracking-tight text-ink">{title}</h1>
        <p className="mt-2 text-sm text-muted">Last updated {updated}</p>

        <div className="mt-10 flex flex-col gap-6 text-sm leading-relaxed">{children}</div>

        <div className="mt-12 flex items-center gap-3 border-t border-line pt-6 text-sm text-muted">
          <Link className="text-accent hover:underline" href="/">
            Back to NewinMeter
          </Link>
          <span className="text-line">·</span>
          <a className="text-accent hover:underline" href="mailto:kefasa112@gmail.com">
            Feedback
          </a>
        </div>
      </main>
    </div>
  );
}
