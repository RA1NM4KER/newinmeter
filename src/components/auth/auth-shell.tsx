import Link from "next/link";
import { ArrowUpRight, Check } from "lucide-react";
import type { ReactNode } from "react";
import { ActivityAssistantDemo } from "@/components/marketing/activity-assistant-demo";
import { AlertPlayground } from "@/components/marketing/alert-playground";
import { DayExplorer } from "@/components/marketing/day-explorer";
import { EnergyPlayground } from "@/components/marketing/energy-playground";
import { Wordmark } from "@/components/layout/wordmark";
import { SUPPORT_MAILTO } from "@/lib/site-config";

type AuthShellProps = {
  badge?: string;
  title: ReactNode;
  description: string;
  children: ReactNode;
};

function TrustPoint({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2">
      <Check className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
      {children}
    </span>
  );
}

export function AuthShell({ badge, title, description, children }: AuthShellProps) {
  return (
    <div data-public-auth className="min-h-screen overflow-x-hidden bg-[#f7f7f3] text-ink">
      <header className="mx-auto flex w-full max-w-[90rem] items-center justify-between px-5 py-5 sm:px-8 lg:px-12 lg:py-6">
        <Wordmark className="text-xl" textClassName="text-ink" accentClassName="text-accent" />
        <a
          href="#sign-in"
          className="rounded-md text-sm font-medium text-ink outline-none transition hover:text-brandTeal focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-4"
        >
          Sign in
        </a>
      </header>

      <main>
        <section className="mx-auto grid w-full max-w-[90rem] items-center gap-12 px-5 pb-14 pt-5 sm:px-8 sm:pb-16 sm:pt-9 lg:grid-cols-[minmax(26rem,0.82fr)_minmax(37rem,1.18fr)] lg:gap-14 lg:px-12 lg:pb-16 lg:pt-8 xl:gap-20">
          <div className="max-w-[34rem]">
            {badge ? <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brandTeal">{badge}</p> : null}
            <h1 className="mt-5 text-[2.7rem] font-semibold leading-[0.98] tracking-[-0.05em] text-ink sm:text-[3.75rem] lg:text-[4.1rem]">
              {title}
            </h1>
            <p className="mt-5 max-w-lg text-base leading-7 text-muted sm:text-lg sm:leading-8">{description}</p>

            <div id="sign-in" className="mt-7 max-w-md scroll-mt-5">
              <p className="mb-4 text-xs font-semibold uppercase tracking-[0.15em] text-ink">Connect your account</p>
              {children}
            </div>

            <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted sm:text-sm">
              <TrustPoint>Free for Newinbosch residents</TrustPoint>
              <TrustPoint>Connects to LiveMopay</TrustPoint>
            </div>
          </div>

          <EnergyPlayground />
        </section>

        <div className="border-y border-line bg-paper" aria-label="Illustrative NewinMeter account summary">
          <div className="mx-auto grid max-w-[90rem] grid-cols-2 px-5 sm:grid-cols-4 sm:px-8 lg:px-12">
            <div className="border-r border-line py-4 pr-4 sm:py-5">
              <p className="text-xs text-muted">Latest balance</p>
              <p className="mt-1 text-lg font-semibold text-ink">R943,81</p>
            </div>
            <div className="py-4 pl-4 sm:border-r sm:border-line sm:px-5 sm:py-5">
              <p className="text-xs text-muted">Electricity rate</p>
              <p className="mt-1 text-lg font-semibold text-ink">R2,52/kWh</p>
            </div>
            <div className="border-r border-t border-line py-4 pr-4 sm:border-t-0 sm:px-5 sm:py-5">
              <p className="text-xs text-muted">Automatic updates</p>
              <p className="mt-1 text-sm font-semibold text-brandTeal">On · periodic</p>
            </div>
            <div className="border-t border-line py-4 pl-4 sm:border-t-0 sm:pl-5 sm:py-5">
              <p className="text-xs text-muted">Data shown here</p>
              <p className="mt-1 text-sm font-semibold text-ink">Illustrative demo</p>
            </div>
          </div>
        </div>

        <DayExplorer />
        <ActivityAssistantDemo />
        <AlertPlayground />

        <section aria-labelledby="final-heading" className="bg-paper">
          <div className="mx-auto max-w-[86rem] px-5 py-14 sm:px-8 sm:py-16 lg:px-12">
            <div className="grid gap-10 border-b border-line pb-12 lg:grid-cols-[1.2fr_0.8fr] lg:items-end">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brandTeal">
                  Your data, made readable
                </p>
                <h2
                  id="final-heading"
                  className="mt-4 max-w-3xl text-3xl font-semibold tracking-[-0.04em] text-ink sm:text-5xl"
                >
                  Your electricity is already telling you what happened.
                </h2>
                <p className="mt-4 max-w-xl text-base leading-7 text-muted">
                  NewinMeter makes it easier to see, label, ask, and act.
                </p>
              </div>
              <a
                className="group inline-flex h-11 w-fit items-center gap-2 rounded-md bg-ink px-4 text-sm font-semibold text-paper outline-none transition hover:bg-brandTeal focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-4 motion-reduce:transition-none lg:justify-self-end"
                href="#sign-in"
              >
                Sign in to NewinMeter
                <ArrowUpRight className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 motion-reduce:transition-none" />
              </a>
            </div>

            <div className="grid gap-6 pt-8 text-sm leading-6 text-muted md:grid-cols-[0.8fr_1.2fr]">
              <div>
                <Wordmark textClassName="text-ink" accentClassName="text-accent" />
                <p className="mt-2">Community-built for Newinbosch residents.</p>
              </div>
              <p className="max-w-2xl">
                Independent of Newinbosch HOA, Livewire, and LiveMopay. By continuing, you agree to our{" "}
                <Link
                  className="font-medium text-ink underline decoration-line underline-offset-4 hover:text-brandTeal"
                  href="/terms"
                >
                  Terms
                </Link>{" "}
                and{" "}
                <Link
                  className="font-medium text-ink underline decoration-line underline-offset-4 hover:text-brandTeal"
                  href="/privacy"
                >
                  Privacy Policy
                </Link>
                .
              </p>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-line bg-paper">
        <div className="mx-auto flex max-w-[86rem] flex-wrap items-center justify-between gap-3 px-5 py-6 text-xs text-muted sm:px-8 lg:px-12">
          <p>NewinMeter · Prepaid electricity, made easier to understand.</p>
          <nav className="flex items-center gap-4" aria-label="Footer">
            <Link className="hover:text-ink" href="/privacy">
              Privacy
            </Link>
            <Link className="hover:text-ink" href="/terms">
              Terms
            </Link>
            <a className="hover:text-ink" href={SUPPORT_MAILTO}>
              Feedback
            </a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
