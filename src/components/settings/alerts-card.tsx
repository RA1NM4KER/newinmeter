import { BellRing } from "lucide-react";
import { IconTile, SettingsGroup, SettingsRow } from "@/components/ui/settings";

// Non-interactive placeholder: there is no alert evaluation engine yet (see
// alerts_enabled on livemopay_connections and the auto-sync-schedule
// migration), so this section deliberately offers nothing to toggle -- a
// setting with no functional effect is worse than no setting at all.
export function AlertsCard() {
  return (
    <SettingsGroup label="Alerts">
      <SettingsRow
        leading={
          <IconTile>
            <BellRing size={18} strokeWidth={2} />
          </IconTile>
        }
        title="Data alerts"
        description="Once automatic updates are running, they'll power alerts for things like a low balance, unusual electricity usage, spending thresholds, and delayed meter data."
        control={
          <span className="inline-flex w-fit items-center rounded-full border border-line bg-canvas px-2 py-0.5 text-[0.6875rem] font-medium text-muted">
            Coming soon
          </span>
        }
      />
    </SettingsGroup>
  );
}
