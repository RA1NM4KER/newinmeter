import { notFound } from "next/navigation";
import { AlertCircle, ArchiveRestore, CheckCircle2, Loader2 } from "lucide-react";

// Local-only, purely static preview of the /restore page's states, side by
// side, with no auth, no real connection, and no live behavior. Never
// reachable in production. Deliberately does NOT mount the real
// RestorationStatus component: that component polls /api/restoration every
// 3s and redirects on a "warm" response, which is exactly correct for real
// usage but actively dangerous here, if this tab's browser session happens
// to already be authenticated (which it will be, on a dev machine someone
// actually uses), that live polling hijacks navigation straight to the real
// dashboard mid-preview. This file is inert markup only, copied from
// restoration-status.tsx's actual JSX branches, kept in sync by eye since
// there's no compiler check tying the two together.
export default function QaUiPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  return (
    <div className="min-h-screen bg-[#f7f7f3] px-6 py-10 text-ink">
      <div className="mx-auto flex max-w-xl flex-col gap-8">
        <div>
          <h1 className="text-xl font-semibold">/restore states (dev preview only)</h1>
          <p className="mt-1.5 text-sm text-muted">
            Static copies of what a real user sees at each stage of the cold-storage restoration flow
            (src/components/restoration/restoration-status.tsx). No auth, no live fetch, no redirect, this page
            cannot navigate anywhere on its own. Not reachable in production.
          </p>
        </div>

        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
            Rebuilding (state: &quot;restoring&quot;, or the identical &quot;cold&quot; instant before the restore
            auto-starts)
          </h2>
          <div className="rounded-2xl border border-line bg-paper px-6 py-8 text-left">
            <Loader2 className="h-6 w-6 animate-spin text-accent" aria-hidden="true" />
            <h3 className="mt-3 text-base font-semibold text-ink">Rebuilding your latest 90 days</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-muted">
              You can leave this page and come back. Refreshing won&rsquo;t start another restoration, and older
              history remains available as daily summaries.
            </p>
          </div>
        </section>

        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
            Hibernating (cold-storage purge itself still finishing when they arrived)
          </h2>
          <div className="rounded-2xl border border-line bg-paper px-6 py-8 text-left">
            <ArchiveRestore className="h-6 w-6 text-accent" aria-hidden="true" />
            <h3 className="mt-3 text-base font-semibold text-ink">Preparing your archived data</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-muted">
              You can leave this page and come back. Refreshing won&rsquo;t start another restoration, and older
              history remains available as daily summaries.
            </p>
          </div>
        </section>

        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
            Restore failed, retryable (transient error, same connection still valid)
          </h2>
          <div className="rounded-2xl border border-red-200 bg-paper px-6 py-7 text-left">
            <AlertCircle className="h-5 w-5 text-red-700" aria-hidden="true" />
            <h3 className="mt-3 text-base font-semibold text-ink">We couldn&rsquo;t restore your recent history</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-muted">
              The restoration request was interrupted. It is safe to retry.
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <span className="inline-flex h-10 items-center rounded-lg bg-ink px-4 text-sm font-semibold text-paper">
                Try again
              </span>
              <span className="inline-flex h-10 items-center rounded-lg border border-line px-4 text-sm font-medium text-muted">
                Sign out
              </span>
            </div>
          </div>
        </section>

        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
            Restore failed, reconnect required (refresh token no longer valid)
          </h2>
          <div className="rounded-2xl border border-red-200 bg-paper px-6 py-7 text-left">
            <AlertCircle className="h-5 w-5 text-red-700" aria-hidden="true" />
            <h3 className="mt-3 text-base font-semibold text-ink">We couldn&rsquo;t restore your recent history</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-muted">
              Reconnect your LiveMopay account to continue.
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <span className="inline-flex h-10 items-center rounded-lg bg-ink px-4 text-sm font-semibold text-paper">
                Reconnect LiveMopay
              </span>
              <span className="inline-flex h-10 items-center rounded-lg border border-line px-4 text-sm font-medium text-muted">
                Sign out
              </span>
            </div>
          </div>
        </section>

        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
            Warm (restoration just finished, this is on screen for an instant before the real redirect to &quot;/&quot;
            fires)
          </h2>
          <div className="rounded-2xl border border-line bg-paper px-6 py-8 text-left">
            <CheckCircle2 className="h-6 w-6 text-brandTeal" aria-hidden="true" />
            <h3 className="mt-3 text-base font-semibold text-ink">Rebuilding your latest 90 days</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-muted">
              You can leave this page and come back. Refreshing won&rsquo;t start another restoration, and older
              history remains available as daily summaries.
            </p>
          </div>
        </section>

        <p className="text-xs text-muted">
          The auto-sync inactivity pause added this session has no UI at all by design, see
          docs/debugging-runbook.md, nothing purged, nothing to show.
        </p>
      </div>
    </div>
  );
}
