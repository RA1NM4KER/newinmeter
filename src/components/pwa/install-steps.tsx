import { Bell, Download, Share, SquarePlus } from "lucide-react";
import type { LucideIcon } from "lucide-react";

function Step({ icon: Icon, children }: { icon: LucideIcon; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accentSoft text-accent">
        <Icon aria-hidden="true" className="h-4 w-4" />
      </span>
      <span className="text-sm leading-relaxed text-ink/80">{children}</span>
    </li>
  );
}

// Shared between the iOS install guide BottomSheet (triggered contextually
// from Alerts/Settings/the dashboard) and the /install page's iOS section --
// one copy of these steps so they can't drift out of sync with each other.
export function IosInstallSteps() {
  return (
    <ol className="flex flex-col gap-3">
      <Step icon={Share}>
        Tap the <span className="font-medium text-ink">Share</span> icon in Safari&apos;s toolbar.
      </Step>
      <Step icon={SquarePlus}>
        Scroll down and tap <span className="font-medium text-ink">Add to Home Screen</span>.
      </Step>
      <Step icon={Download}>
        Tap <span className="font-medium text-ink">Add</span> in the top right.
      </Step>
      <Step icon={Bell}>Open NewinMeter from your Home Screen, then turn on notifications.</Step>
    </ol>
  );
}
