import Image from "next/image";
import Link from "next/link";
import { Bell, Check, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { Wordmark } from "@/components/layout/wordmark";

type AuthShellProps = {
  badge?: string;
  title: ReactNode;
  description: string;
  children: ReactNode;
};

const usageBars = [32, 38, 35, 44, 40, 48, 42, 53, 45, 58, 50, 68, 52, 47, 43, 56, 49, 45];

function ProductFrame({ className = "" }: { className?: string }) {
  return (
    <figure className={className}>
      <div className="overflow-hidden rounded-xl border border-line bg-paper shadow-[0_24px_70px_rgba(20,35,28,0.12)]">
        <div className="flex items-center justify-between border-b border-line bg-paper px-3 py-2.5 sm:px-4">
          <div className="flex items-center gap-1.5" aria-hidden="true">
            <span className="h-2 w-2 rounded-full bg-line" />
            <span className="h-2 w-2 rounded-full bg-line" />
            <span className="h-2 w-2 rounded-full bg-line" />
          </div>
          <span className="text-[0.625rem] font-medium uppercase tracking-[0.18em] text-muted">
            Your meter at a glance
          </span>
        </div>
        <div className="h-[17rem] overflow-hidden bg-canvas sm:h-auto">
          <Image
            src="/dashboard-preview.png"
            alt="NewinMeter dashboard showing balance, spend, electricity usage, tariff, and daily charts"
            width={2000}
            height={1073}
            priority
            sizes="(max-width: 767px) 36rem, (max-width: 1279px) 48vw, 50rem"
            className="h-full w-auto max-w-none -translate-x-[13%] object-cover sm:h-auto sm:w-full sm:translate-x-0"
          />
        </div>
      </div>
      <figcaption className="mt-3 text-xs leading-5 text-muted">
        A clear view of your latest LiveMopay data — balance, spend, usage, and tariff included.
      </figcaption>
    </figure>
  );
}

function UsagePreview() {
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-paper">
      <div className="grid grid-cols-3 border-b border-line">
        <div className="border-r border-line p-3 sm:p-4">
          <p className="text-xs text-muted">Latest balance</p>
          <p className="mt-2 text-base font-semibold tracking-tight text-accent sm:text-xl">R 943,81</p>
          <p className="mt-1 text-[0.6875rem] text-muted">17 Aug · 23:30</p>
        </div>
        <div className="border-r border-line p-3 sm:p-4">
          <p className="text-xs text-muted">Total spend</p>
          <p className="mt-2 text-base font-semibold tracking-tight text-ink sm:text-xl">R 3 571,19</p>
          <p className="mt-1 text-[0.6875rem] text-muted">incl. fixed charges</p>
        </div>
        <div className="p-3 sm:p-4">
          <p className="text-xs text-muted">Electricity rate</p>
          <p className="mt-2 text-base font-semibold tracking-tight text-ink sm:text-xl">R2,52/kWh</p>
          <p className="mt-1 text-[0.6875rem] text-muted">effective energy rate</p>
        </div>
      </div>
      <div className="p-4 sm:p-5">
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-ink">Daily usage</p>
            <p className="mt-0.5 text-xs text-muted">Past 18 days · kWh</p>
          </div>
          <p className="text-xs font-medium text-accent">12,9 kWh/day</p>
        </div>
        <div
          className="mt-5 flex h-36 items-end gap-1.5 border-b border-line px-1"
          aria-label="Daily electricity usage chart"
          role="img"
        >
          {usageBars.map((height, index) => (
            <span
              aria-hidden="true"
              className={`min-w-0 flex-1 rounded-t-sm ${index === 11 ? "bg-brandTeal" : "bg-accent"}`}
              key={`${height}-${index}`}
              style={{ height: `${height}%` }}
            />
          ))}
        </div>
        <div className="mt-2 flex justify-between text-[0.625rem] text-muted">
          <span>31 Jul</span>
          <span>8 Aug</span>
          <span>17 Aug</span>
        </div>
      </div>
    </div>
  );
}

function ExplanationPreview() {
  return (
    <div className="rounded-lg border border-line bg-paper p-4 sm:p-5">
      <div className="flex items-start justify-between gap-4 border-b border-line pb-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted">Activity</p>
          <p className="mt-2 text-sm font-semibold text-ink">Geyser</p>
          <p className="mt-1 text-xs text-muted">Yesterday · 18:00–20:00</p>
        </div>
        <span className="rounded-md bg-accentSoft px-2.5 py-1 text-xs font-medium text-brandTeal">Tagged</span>
      </div>

      <div className="mt-5 flex flex-col gap-4">
        <div className="ml-auto max-w-[84%] rounded-2xl bg-ink px-4 py-2.5 text-sm leading-6 text-paper">
          Why was yesterday expensive?
        </div>
        <div className="max-w-[31rem]">
          <p className="text-sm font-semibold text-ink">Yesterday was above your recent daily average.</p>
          <p className="mt-1 text-sm leading-6 text-muted">
            Your highest-usage period was 18:30. It overlaps your Geyser Activity, but the data cannot confirm what
            caused the increase.
          </p>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
            <span>
              <strong className="font-semibold text-ink">21,84 kWh</strong> used
            </span>
            <span>
              <strong className="font-semibold text-ink">R 78,99</strong> spent
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function AlertsPreview() {
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-paper">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3.5 sm:px-5">
        <div className="flex items-center gap-2">
          <Bell className="h-4 w-4 text-brandTeal" aria-hidden="true" />
          <p className="text-sm font-semibold text-ink">Notifications</p>
        </div>
        <span className="inline-flex items-center gap-1.5 text-xs text-muted">
          <RefreshCw className="h-3 w-3" aria-hidden="true" />
          Updated automatically
        </span>
      </div>
      <div className="divide-y divide-line">
        <div className="flex items-start gap-3 bg-accentSoft/40 px-4 py-4 sm:px-5">
          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden="true" />
          <div>
            <p className="text-[0.8125rem] font-medium text-ink">Balance below R300</p>
            <p className="mt-0.5 text-[0.8125rem] leading-snug text-muted">Your latest balance is R286,40.</p>
            <p className="mt-1 text-xs text-muted/80">8 minutes ago</p>
          </div>
        </div>
        <div className="flex items-start gap-3 px-4 py-4 sm:px-5">
          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden="true" />
          <div>
            <p className="text-[0.8125rem] font-medium text-ink">Unusual daily usage</p>
            <p className="mt-0.5 text-[0.8125rem] leading-snug text-muted">
              Yesterday was higher than your recent pattern.
            </p>
            <p className="mt-1 text-xs text-muted/80">Yesterday</p>
          </div>
        </div>
        <div className="flex items-center gap-2 px-4 py-3 text-xs text-muted sm:px-5">
          <Check className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
          Automatic updates keep alerts current between visits.
        </div>
      </div>
    </div>
  );
}

export function AuthShell({ badge, title, description, children }: AuthShellProps) {
  return (
    <div data-public-auth className="min-h-screen overflow-x-hidden bg-[#f7f7f3] text-ink">
      <header className="mx-auto flex w-full max-w-[84rem] items-center justify-between px-5 py-5 sm:px-8 lg:px-12 lg:py-7">
        <Wordmark className="text-xl" textClassName="text-ink" accentClassName="text-accent" />
        <a
          href="#sign-in"
          className="rounded-md px-2 py-1 text-sm font-medium text-ink outline-none transition hover:text-brandTeal focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
        >
          Sign in
        </a>
      </header>

      <main>
        <section className="mx-auto grid w-full max-w-[84rem] items-center gap-12 px-5 pb-16 pt-6 sm:px-8 sm:pb-20 sm:pt-10 lg:grid-cols-[minmax(0,0.88fr)_minmax(34rem,1.12fr)] lg:gap-16 lg:px-12 lg:py-16 xl:gap-24 xl:py-20">
          <div className="max-w-xl">
            {badge ? <p className="text-xs font-semibold uppercase tracking-[0.17em] text-brandTeal">{badge}</p> : null}
            <h1 className="mt-5 text-[2.65rem] font-semibold leading-[1.02] tracking-[-0.045em] text-ink sm:text-6xl lg:text-[4rem]">
              {title}
            </h1>
            <p className="mt-5 max-w-lg text-base leading-7 text-muted sm:text-lg sm:leading-8">{description}</p>

            <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm text-ink">
              <span className="inline-flex items-center gap-2">
                <Check className="h-4 w-4 text-accent" aria-hidden="true" />
                Free for Newinbosch residents
              </span>
              <span className="inline-flex items-center gap-2">
                <Check className="h-4 w-4 text-accent" aria-hidden="true" />
                Connects to LiveMopay
              </span>
            </div>

            <section
              id="sign-in"
              aria-labelledby="sign-in-title"
              className="mt-8 max-w-md scroll-mt-6 border-t border-ink/15 pt-6"
            >
              <div className="mb-5">
                <h2 id="sign-in-title" className="text-base font-semibold text-ink">
                  Sign in to NewinMeter
                </h2>
                <p className="mt-1 text-sm text-muted">Use Google or get a one-time code by email.</p>
              </div>
              {children}
            </section>
          </div>

          <ProductFrame className="min-w-0 lg:translate-y-2" />
        </section>

        <section aria-labelledby="understand-heading" className="border-y border-line bg-paper">
          <div className="mx-auto grid w-full max-w-[78rem] items-center gap-10 px-5 py-16 sm:px-8 sm:py-20 lg:grid-cols-[0.78fr_1.22fr] lg:gap-20 lg:px-10 lg:py-24">
            <div className="max-w-md">
              <p className="text-xs font-semibold uppercase tracking-[0.17em] text-brandTeal">Understand your usage</p>
              <h2
                id="understand-heading"
                className="mt-4 text-3xl font-semibold tracking-[-0.035em] text-ink sm:text-4xl"
              >
                See where your money went.
              </h2>
              <p className="mt-4 text-base leading-7 text-muted">
                Follow daily spend and electricity use, check your latest balance, and understand the tariff behind the
                numbers. History makes changes easier to spot.
              </p>
            </div>
            <UsagePreview />
          </div>
        </section>

        <section aria-labelledby="explain-heading">
          <div className="mx-auto grid w-full max-w-[78rem] items-center gap-10 px-5 py-16 sm:px-8 sm:py-20 lg:grid-cols-[1.18fr_0.82fr] lg:gap-20 lg:px-10 lg:py-24">
            <div className="order-2 lg:order-1">
              <ExplanationPreview />
            </div>
            <div className="order-1 max-w-md lg:order-2">
              <p className="text-xs font-semibold uppercase tracking-[0.17em] text-brandTeal">Explain what happened</p>
              <h2 id="explain-heading" className="mt-4 text-3xl font-semibold tracking-[-0.035em] text-ink sm:text-4xl">
                Add context. Ask what changed.
              </h2>
              <p className="mt-4 text-base leading-7 text-muted">
                Tag household Activities, then ask NewinMeter about an unusual day. Answers connect the data and your
                context without pretending an overlap proves the cause.
              </p>
            </div>
          </div>
        </section>

        <section aria-labelledby="alerts-heading" className="border-y border-line bg-[#eef4f0]">
          <div className="mx-auto grid w-full max-w-[78rem] items-center gap-10 px-5 py-16 sm:px-8 sm:py-20 lg:grid-cols-[0.8fr_1.2fr] lg:gap-20 lg:px-10 lg:py-24">
            <div className="max-w-md">
              <p className="text-xs font-semibold uppercase tracking-[0.17em] text-brandTeal">Know before you check</p>
              <h2 id="alerts-heading" className="mt-4 text-3xl font-semibold tracking-[-0.035em] text-ink sm:text-4xl">
                Get notified before your balance becomes a problem.
              </h2>
              <p className="mt-4 text-base leading-7 text-muted">
                Automatic updates can watch for low balance, higher spend, tariff changes, delayed data, and unusual
                usage — even when NewinMeter is closed.
              </p>
            </div>
            <AlertsPreview />
          </div>
        </section>

        <section aria-labelledby="trust-heading" className="bg-paper">
          <div className="mx-auto grid w-full max-w-[78rem] gap-8 px-5 py-14 sm:px-8 sm:py-16 md:grid-cols-[0.72fr_1.28fr] md:items-start lg:px-10">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.17em] text-brandTeal">
                Built for the community
              </p>
              <h2 id="trust-heading" className="mt-3 text-2xl font-semibold tracking-tight text-ink">
                Useful, independent, and free.
              </h2>
            </div>
            <div className="max-w-2xl text-sm leading-6 text-muted">
              <p>
                NewinMeter is community-built for Newinbosch residents and connects to LiveMopay to turn meter data into
                a clearer household view.
              </p>
              <p className="mt-3">
                It is independent of Newinbosch HOA, Livewire, and LiveMopay. By continuing, you agree to our{" "}
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
        <div className="mx-auto flex w-full max-w-[78rem] flex-col gap-2 px-5 py-7 text-xs text-muted sm:flex-row sm:items-center sm:justify-between sm:px-8 lg:px-10">
          <Wordmark textClassName="text-ink" accentClassName="text-accent" />
          <p>Prepaid electricity, made easier to understand.</p>
        </div>
      </footer>
    </div>
  );
}
