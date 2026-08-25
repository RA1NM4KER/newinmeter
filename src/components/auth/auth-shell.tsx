"use client";

import Link from "next/link";
import { ArrowUpRight, Check } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { ActivityAssistantDemo } from "@/components/marketing/activity-assistant-demo";
import { AlertPlayground } from "@/components/marketing/alert-playground";
import { DayExplorer } from "@/components/marketing/day-explorer";
import { demoScenarios, type DemoScenarioId } from "@/components/marketing/demo-data";
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
  const [scenarioId, setScenarioId] = useState<DemoScenarioId>("lateNight");
  const [selectedTime, setSelectedTime] = useState("22:30");

  function chooseScenario(nextScenarioId: DemoScenarioId) {
    const nextScenario = demoScenarios[nextScenarioId];
    setScenarioId(nextScenarioId);
    setSelectedTime(nextScenario.points[nextScenario.focusIndex].time);
  }

  useEffect(() => {
    document.documentElement.classList.add("public-smooth-scroll");
    return () => document.documentElement.classList.remove("public-smooth-scroll");
  }, []);

  return (
    <div data-public-auth className="min-h-screen overflow-x-clip bg-[#f7f7f3] text-ink">
      <header className="sticky top-0 z-50 border-b border-line/70 bg-[#f7f7f3]">
        <div className="mx-auto flex w-full max-w-[90rem] items-center justify-between px-5 py-4 sm:px-8 lg:px-12">
          <Wordmark className="text-xl" textClassName="text-ink" accentClassName="text-accent" />
          <a
            href="#sign-in"
            className="rounded-md text-sm font-medium text-ink outline-none transition hover:text-brandTeal focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-4"
          >
            Sign in
          </a>
        </div>
      </header>

      <main>
        <section className="mx-auto grid w-full max-w-[90rem] items-center gap-11 px-5 pb-14 pt-5 sm:px-8 sm:pb-16 sm:pt-9 lg:grid-cols-[minmax(26rem,0.82fr)_minmax(37rem,1.18fr)] lg:gap-14 lg:px-12 lg:pb-20 lg:pt-8 xl:gap-20">
          <div className="max-w-[34rem]">
            {badge ? (
              <p className="mb-5 text-xs font-semibold uppercase tracking-[0.18em] text-brandTeal">{badge}</p>
            ) : null}
            <h1 className="text-[2.7rem] font-semibold leading-[0.98] tracking-[-0.05em] text-ink sm:text-[3.75rem] lg:text-[4.1rem]">
              {title}
            </h1>
            <p className="mt-5 max-w-lg text-base leading-7 text-muted sm:text-lg sm:leading-8">{description}</p>

            <div id="sign-in" aria-label="Sign in to NewinMeter" className="mt-8 max-w-md scroll-mt-24">
              {children}
            </div>

            <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted sm:text-sm">
              <TrustPoint>Free for Newinbosch residents</TrustPoint>
              <TrustPoint>Connects to LiveMopay</TrustPoint>
            </div>
          </div>

          <EnergyPlayground scenarioId={scenarioId} onScenarioChange={chooseScenario} onPointChange={setSelectedTime} />
        </section>

        <DayExplorer storyScenarioId={scenarioId} storySelectedTime={selectedTime} />
        <ActivityAssistantDemo storyScenarioId={scenarioId} storySelectedTime={selectedTime} />
        <AlertPlayground storyScenarioId={scenarioId} />
      </main>

      <footer className="bg-paper">
        <div className="mx-auto max-w-[86rem] px-5 py-14 sm:px-8 sm:py-16 lg:px-12">
          <div className="grid gap-7 lg:grid-cols-[1.2fr_0.8fr] lg:items-end">
            <div>
              <h2 className="max-w-3xl text-3xl font-semibold tracking-[-0.04em] text-ink sm:text-5xl">
                Now look at your own.
              </h2>
              <p className="mt-3 text-base text-muted">Sign in to explore your electricity history.</p>
            </div>
            <a
              className="group inline-flex h-11 w-fit items-center gap-2 rounded-md bg-ink px-4 text-sm font-semibold text-paper outline-none transition hover:bg-brandTeal focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-4 motion-reduce:transition-none lg:justify-self-end"
              href="#sign-in"
            >
              Sign in to NewinMeter
              <ArrowUpRight className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 motion-reduce:transition-none" />
            </a>
          </div>

          <div className="mt-12 grid gap-6 border-t border-line pt-7 text-xs leading-5 text-muted md:grid-cols-[0.7fr_1.3fr]">
            <div>
              <Wordmark textClassName="text-ink" accentClassName="text-accent" />
              <p className="mt-2">Community-built for Newinbosch residents.</p>
            </div>
            <div className="md:justify-self-end">
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
              <p className="mt-3 max-w-2xl">
                Independent of Newinbosch HOA, Livewire, and LiveMopay. By continuing, you agree to the Terms and
                Privacy Policy.
              </p>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
