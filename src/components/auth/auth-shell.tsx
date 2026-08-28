"use client";

import Link from "next/link";
import { useEffect, type ReactNode } from "react";
import { Check } from "lucide-react";
import { EnergyPlayground } from "@/components/marketing/energy-playground";
import { Wordmark } from "@/components/layout/wordmark";
import { SUPPORT_MAILTO } from "@/lib/site-config";

type AuthShellProps = {
  badge?: string;
  title: ReactNode;
  description: string;
  children: ReactNode;
  // "landing" (default) is /login: a first-time visitor who may not know
  // what NewinMeter is yet, so it keeps one interactive teaser
  // (EnergyPlayground) beside the sign-in actions. "focused" is /connect: a
  // signed-in resident who already chose to be here and just needs to get
  // through one form -- no teaser, no footer sales pitch, nothing to
  // scroll past. See the login/connect redesign notes in the README.
  variant?: "landing" | "focused";
};

function TrustPoint({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2">
      <Check className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
      {children}
    </span>
  );
}

export function AuthShell({ badge, title, description, children, variant = "landing" }: AuthShellProps) {
  useEffect(() => {
    document.documentElement.classList.add("public-smooth-scroll");
    return () => document.documentElement.classList.remove("public-smooth-scroll");
  }, []);

  const isLanding = variant === "landing";

  return (
    <div data-public-auth className="min-h-screen overflow-x-clip bg-[#f7f7f3] text-ink">
      <header className="sticky top-0 z-50 border-b border-line/70 bg-[#f7f7f3]">
        <div className="mx-auto flex w-full max-w-[90rem] items-center justify-between px-5 py-4 sm:px-8 lg:px-12">
          <Wordmark className="text-xl" textClassName="text-ink" accentClassName="text-accent" />
          {isLanding ? (
            <a
              href="#sign-in"
              className="rounded-md text-sm font-medium text-ink outline-none transition hover:text-brandTeal focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-4"
            >
              Sign in
            </a>
          ) : null}
        </div>
      </header>

      <main>
        <section
          className={
            isLanding
              ? "mx-auto grid w-full max-w-[90rem] items-center gap-11 px-5 pb-14 pt-5 sm:px-8 sm:pb-16 sm:pt-9 lg:grid-cols-[minmax(26rem,0.82fr)_minmax(37rem,1.18fr)] lg:gap-14 lg:px-12 lg:pb-20 lg:pt-8 xl:gap-20"
              : "mx-auto w-full max-w-2xl px-5 pb-16 pt-8 sm:px-8"
          }
        >
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

            {isLanding ? (
              <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted sm:text-sm">
                <TrustPoint>Free for Newinbosch residents</TrustPoint>
                <TrustPoint>Connects to LiveMopay</TrustPoint>
              </div>
            ) : null}
          </div>

          {isLanding ? <EnergyPlayground /> : null}
        </section>
      </main>

      <footer className="bg-paper">
        <div className="mx-auto max-w-[86rem] px-5 py-8 sm:px-8 lg:px-12">
          <div className="flex flex-col gap-4 border-t border-line pt-7 text-xs leading-5 text-muted sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <Wordmark textClassName="text-ink" accentClassName="text-accent" />
              <span>Community-built for Newinbosch residents.</span>
            </div>
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
          <p className="mt-3 max-w-2xl text-xs text-muted">
            Independent of Newinbosch HOA, Livewire, and LiveMopay. By continuing, you agree to the Terms and Privacy
            Policy.
          </p>
        </div>
      </footer>
    </div>
  );
}
