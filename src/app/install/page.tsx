import Link from "next/link";
import { Download, MonitorDown, Share, SquarePlus } from "lucide-react";
import { Wordmark } from "@/components/layout/wordmark";
import { SUPPORT_MAILTO } from "@/lib/site-config";

export const metadata = {
  title: "Install NewinMeter"
};

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

export default function InstallPage() {
  return (
    <div className="min-h-screen bg-canvas">
      <header className="sticky top-0 z-20 border-b border-line bg-canvas/90 px-6 py-5 backdrop-blur">
        <Link href="/">
          <Wordmark className="text-xl" textClassName="text-ink" accentClassName="text-accent" />
        </Link>
      </header>

      <main className="mx-auto max-w-2xl px-6 py-12">
        <h1 className="text-3xl font-semibold tracking-tight text-ink">Install NewinMeter</h1>
        <p className="mt-2 text-sm text-muted">
          Add NewinMeter to your home screen for one-tap access, a full-screen app view, and offline access to your last
          loaded data. No app store needed.
        </p>

        <div className="mt-8 flex flex-col gap-4">
          <PlatformCard title="iPhone or iPad (Safari)">
            <Step icon={Share}>
              Tap the <span className="font-medium text-ink">Share</span> icon in Safari&apos;s toolbar.
            </Step>
            <Step icon={SquarePlus}>
              Scroll down and tap <span className="font-medium text-ink">Add to Home Screen</span>.
            </Step>
            <Step icon={Download}>
              Tap <span className="font-medium text-ink">Add</span> in the top right. NewinMeter now opens like any
              other app.
            </Step>
          </PlatformCard>

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

        <div className="mt-10 flex items-center gap-3 border-t border-line pt-6 text-sm text-muted">
          <Link className="text-accent hover:underline" href="/">
            Back to NewinMeter
          </Link>
          <span className="text-line">·</span>
          <a className="text-accent hover:underline" href={SUPPORT_MAILTO}>
            Feedback
          </a>
        </div>
      </main>
    </div>
  );
}
