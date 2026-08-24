"use client";

import Link from "next/link";
import { Download, MonitorDown, Share, SquarePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TopBar } from "@/components/layout/top-bar";
import { SUPPORT_MAILTO } from "@/lib/site-config";
import { usePwaInstall } from "./pwa-install-provider";
import { IosInstallSteps } from "./install-steps";

function Step({ icon: Icon, children }: { icon: typeof Share; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accentSoft text-accent">
        <Icon aria-hidden="true" className="h-4 w-4" />
      </span>
      <span className="text-sm leading-relaxed text-ink/80">{children}</span>
    </li>
  );
}

function PlatformCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-paper p-5">
      <h2 className="text-base font-semibold text-ink">{title}</h2>
      <ol className="mt-4 flex flex-col gap-3">{children}</ol>
    </section>
  );
}

// Fallback material for platforms this page can't confidently detect a
// better path for (e.g. non-Chromium desktop browsers without
// beforeinstallprompt) -- reused, not deleted, from the previous static
// three-card page.
function ManualPlatformInstructions() {
  return (
    <div className="mt-8 flex flex-col gap-4">
      <PlatformCard title="Android (Chrome)">
        <Step icon={Share}>
          Tap the <span className="font-medium text-ink">⋮ menu</span> in Chrome&apos;s toolbar.
        </Step>
        <Step icon={SquarePlus}>
          Tap <span className="font-medium text-ink">Add to Home screen</span> or{" "}
          <span className="font-medium text-ink">Install app</span>.
        </Step>
        <Step icon={Download}>
          Confirm by tapping <span className="font-medium text-ink">Install</span>.
        </Step>
      </PlatformCard>

      <PlatformCard title="Desktop (Chrome or Edge)">
        <Step icon={MonitorDown}>
          Click the install icon at the right of the address bar (or open the browser menu and choose{" "}
          <span className="font-medium text-ink">Install NewinMeter</span>).
        </Step>
        <Step icon={Download}>Confirm to add it as a desktop app with its own window.</Step>
      </PlatformCard>
    </div>
  );
}

function PageFooter() {
  return (
    <div className="mt-10 flex items-center gap-3 border-t border-line pt-6 text-sm text-muted">
      <Link className="text-accent hover:underline" href="/">
        Back to NewinMeter
      </Link>
      <span className="text-line">·</span>
      <a className="text-accent hover:underline" href={SUPPORT_MAILTO}>
        Feedback
      </a>
    </div>
  );
}

export function InstallPageClient() {
  const { ready, isStandalone, isIos, canPromptInstall, promptInstall } = usePwaInstall();

  if (ready && isStandalone) {
    return (
      <div className="min-h-screen bg-canvas">
        <TopBar className="sticky top-0 z-20" />
        <main className="mx-auto max-w-2xl px-6 py-12">
          <h1 className="text-3xl font-semibold tracking-tight text-ink">NewinMeter is already installed</h1>
          <p className="mt-2 text-sm text-muted">
            You&apos;re all set -- open NewinMeter from your Home Screen or app list.
          </p>
          <div className="mt-6">
            <Button href="/">Open NewinMeter</Button>
          </div>
          <PageFooter />
        </main>
      </div>
    );
  }

  if (ready && isIos) {
    return (
      <div className="min-h-screen bg-canvas">
        <TopBar className="sticky top-0 z-20" />
        <main className="mx-auto max-w-2xl px-6 py-12">
          <h1 className="text-3xl font-semibold tracking-tight text-ink">Get NewinMeter alerts on your phone</h1>
          <p className="mt-2 text-sm text-muted">
            Add NewinMeter to your Home Screen to get quick access and enable phone notifications.
          </p>
          <div className="mt-8">
            <PlatformCard title="Add to Home Screen">
              <IosInstallSteps />
            </PlatformCard>
          </div>
          <PageFooter />
        </main>
      </div>
    );
  }

  if (ready && canPromptInstall) {
    return (
      <div className="min-h-screen bg-canvas">
        <TopBar className="sticky top-0 z-20" />
        <main className="mx-auto max-w-2xl px-6 py-12">
          <h1 className="text-3xl font-semibold tracking-tight text-ink">Install NewinMeter</h1>
          <p className="mt-2 text-sm text-muted">
            Get quick access and electricity alerts on this device -- no app store needed.
          </p>
          <div className="mt-6">
            <Button onClick={() => void promptInstall()}>Install NewinMeter</Button>
          </div>
          <PageFooter />
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-canvas">
      <TopBar className="sticky top-0 z-20" />
      <main className="mx-auto max-w-2xl px-6 py-12">
        <h1 className="text-3xl font-semibold tracking-tight text-ink">Install NewinMeter</h1>
        <p className="mt-2 text-sm text-muted">
          Add NewinMeter to your home screen for quick access and electricity alerts. No app store needed.
        </p>
        <ManualPlatformInstructions />
        <PageFooter />
      </main>
    </div>
  );
}
