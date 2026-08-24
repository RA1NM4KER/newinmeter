export type SettingsTabId = "general" | "data-sync" | "alerts" | "account";

export const settingsTabs: Array<{ id: SettingsTabId; label: string }> = [
  { id: "general", label: "General" },
  { id: "data-sync", label: "Data & Sync" },
  { id: "alerts", label: "Alerts" },
  { id: "account", label: "Account" }
];

export function isSettingsTabId(value: string): value is SettingsTabId {
  return settingsTabs.some((tab) => tab.id === value);
}
