"use client";

import { BottomSheet } from "@/components/ui/bottom-sheet";
import { IosInstallSteps } from "./install-steps";

type IosInstallGuideSheetProps = {
  isOpen: boolean;
  onClose: () => void;
};

// One global instance, mounted by PwaInstallProvider -- any component calls
// usePwaInstall().openInstallGuide() to show this, rather than each caller
// (AlertRuleRow, DeviceNotificationStatus, the dashboard promo) owning its
// own copy of the same sheet.
export function IosInstallGuideSheet({ isOpen, onClose }: IosInstallGuideSheetProps) {
  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} title="Get alerts on your phone">
      <p className="mb-4 text-sm leading-relaxed text-muted">
        Add NewinMeter to your Home Screen so electricity alerts can reach you even when you&apos;re not checking the
        app.
      </p>
      <IosInstallSteps />
    </BottomSheet>
  );
}
