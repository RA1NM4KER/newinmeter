// Feature keys, rollout modes, and display metadata -- no server-only
// dependencies, so this is safe to import from both server code (features.ts)
// and client components (admin UI). The DB-backed access logic itself lives
// in features.ts.

export const FEATURE_KEYS = ["ai", "activities", "live", "alerts"] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];

export const ROLLOUT_MODES = ["everyone", "selected", "off"] as const;
export type RolloutMode = (typeof ROLLOUT_MODES)[number];

export type FeatureMeta = {
  key: FeatureKey;
  name: string;
  short: string;
  description: string;
};

export const FEATURE_META: Record<FeatureKey, FeatureMeta> = {
  ai: {
    key: "ai",
    name: "AI Assistant",
    short: "AI",
    description: "Account-aware NewinMeter assistant."
  },
  activities: {
    key: "activities",
    name: "Activities",
    short: "Activities",
    description: "Usage notes, tags and reporting."
  },
  live: {
    key: "live",
    name: "Live Meter",
    short: "Live",
    description: "Experimental live meter telemetry."
  },
  alerts: {
    key: "alerts",
    name: "Alerts",
    short: "Alerts",
    description: "Proactive usage and spending alerts."
  }
};

export const FEATURES: FeatureMeta[] = FEATURE_KEYS.map((key) => FEATURE_META[key]);

export function isFeatureKey(value: string): value is FeatureKey {
  return (FEATURE_KEYS as readonly string[]).includes(value);
}

export function isRolloutMode(value: string): value is RolloutMode {
  return (ROLLOUT_MODES as readonly string[]).includes(value);
}
