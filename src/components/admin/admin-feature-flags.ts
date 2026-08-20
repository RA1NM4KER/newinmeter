export const FEATURES = [
  {
    key: "aiAssistantEnabled",
    short: "AI",
    name: "AI Assistant",
    description: "Access to the account-aware NewinMeter assistant."
  },
  {
    key: "activitiesEnabled",
    short: "Activities",
    name: "Activities",
    description: "Daily notes, tags and activity reporting."
  },
  {
    key: "liveMeterEnabled",
    short: "Live",
    name: "Live Meter",
    description: "Experimental optical meter telemetry and live usage view."
  }
] as const;

export type FeatureKey = (typeof FEATURES)[number]["key"];
export type FeatureDraft = Record<FeatureKey, boolean>;
