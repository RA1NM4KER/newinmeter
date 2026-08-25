"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Smartphone, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePwaInstall } from "@/components/pwa/pwa-install-provider";
import { dismissInstallPromo, isInstallPromoCoolingDown } from "@/lib/pwa-install-prompt";

type InstallPromoCardProps = {
  alertsEnabled: boolean;
  isDemo: boolean;
};

// One restrained, dismissible install nudge on the dashboard -- the highest-
// traffic surface, so it's the main lever for actually getting more users
// installed, but it must stay quiet: shown only where the current install
// eligibility rules allow it, gone the instant this device is standalone,
// and hidden during the dismissal cooldown (shared with AlertRuleRow's iOS setup
// prompt via lib/pwa-install-prompt.ts).
export function InstallPromoCard({ alertsEnabled, isDemo }: InstallPromoCardProps) {
  const router = useRouter();
  const { ready, isStandalone, isIos, isMobile, canPromptInstall, promptInstall, openInstallGuide } = usePwaInstall();
  const [dismissed, setDismissed] = useState(true);

  // Reads localStorage only after mount -- keeps this component's first
  // client render identical to its server render (both start hidden), then
  // reveals itself once we actually know the cooldown hasn't been set.
  useEffect(() => {
    setDismissed(isInstallPromoCoolingDown());
  }, []);

  if (!ready || dismissed || isStandalone || !isMobile || !alertsEnabled || isDemo) {
    return null;
  }

  function handleDismiss() {
    dismissInstallPromo();
    setDismissed(true);
  }

  async function handleSetUp() {
    if (isIos) {
      openInstallGuide();
      return;
    }
    if (canPromptInstall) {
      await promptInstall();
      return;
    }
    router.push("/install");
  }

  return (
    <section className="flex items-center gap-3 rounded-xl border border-line bg-paper px-4 py-3 shadow-soft">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[0.625rem] border border-line bg-canvas text-ink/70">
        <Smartphone aria-hidden="true" size={18} strokeWidth={2} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[0.9375rem] font-medium text-ink">Install NewinMeter</p>
        <p className="mt-0.5 text-[0.8125rem] leading-snug text-muted">
          Get quick access and notifications on this device.
        </p>
      </div>
      <Button variant="secondary" size="sm" onClick={() => void handleSetUp()} className="shrink-0">
        Install
      </Button>
      <button
        aria-label="Dismiss"
        className="shrink-0 rounded-md p-1 text-muted transition hover:text-ink"
        onClick={handleDismiss}
        type="button"
      >
        <X aria-hidden="true" className="h-4 w-4" />
      </button>
    </section>
  );
}
