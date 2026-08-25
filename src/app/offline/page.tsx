import Link from "next/link";
import { AppShell } from "@/components/layout/app-shell";
import { QueryProvider } from "@/components/providers/query-provider";

export const dynamic = "force-static";

export default function OfflinePage() {
  return (
    // AppShell now mounts a DayDetailProvider (see day-detail-provider.tsx)
    // that calls useQuery unconditionally -- needs a QueryClientProvider
    // ancestor even though this static page never actually opens it, same
    // as the (app) route group's own layout.
    <QueryProvider>
      <AppShell>
        <section className="flex flex-1 items-center py-10 sm:py-16">
          <div className="w-full rounded-2xl border border-line bg-paper p-6 shadow-soft sm:p-8">
            <p className="text-sm font-medium uppercase tracking-[0.16em] text-muted">Offline</p>
            <h1 className="mt-3 text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
              You are offline right now.
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-muted sm:text-base">
              NewinMeter could not reach the network. If you have visited this page before, some recent screens may
              still load from cache. Live dashboard and data refreshes need a connection.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                href="/"
                className="inline-flex items-center rounded-md bg-ink px-4 py-2 text-sm font-medium text-paper transition hover:opacity-90"
              >
                Go to dashboard
              </Link>
              <Link
                href="/data"
                className="inline-flex items-center rounded-md border border-line bg-paper px-4 py-2 text-sm font-medium text-ink transition hover:bg-canvas"
              >
                Open data page
              </Link>
            </div>
          </div>
        </section>
      </AppShell>
    </QueryProvider>
  );
}
