// Shared Live-telemetry API contract. Pure types only (no server-only), so the
// browser client and the server route/data layer agree on one shape.

export type LiveWindow = "15m" | "30m" | "1h" | "6h";

// Presentation-only device info. Deliberately omits everything secret --
// api_key_hash, key_hint, the raw key, ids -- none of which ever reach the
// browser.
export type LiveDeviceInfo = {
  name: string;
  pulsesPerKwh: number;
};

// "fresh"   -> a current, confidently live estimate.
// "stale"   -> we have a last estimate but no recent pulse; de-emphasise it.
// "waiting" -> not enough data to estimate power yet (0 or 1 pulse).
export type EstimateState = "fresh" | "stale" | "waiting";

export type LiveLatest = {
  estimatedWatts: number | null;
  estimateState: EstimateState;
  lastPulseAt: string | null;
  lastDeltaMs: number | null;
  // Restrained absolute change vs the load ~1 minute ago (signed watts), or
  // null when there isn't enough recent data to compare honestly.
  changeWattsLastMinute: number | null;
};

export type LiveEnergy = {
  last5MinutesKwh: number;
  lastHourKwh: number;
};

export type SeriesPoint = {
  timestamp: string;
  watts: number;
};

export type LiveOverview = {
  // null => the user has the feature but no enabled meter device configured.
  device: LiveDeviceInfo | null;
  window: LiveWindow;
  latest: LiveLatest;
  energy: LiveEnergy;
  series: SeriesPoint[];
  // Server clock at generation, so the client can compute "last pulse X ago"
  // against a trusted now rather than a possibly-skewed browser clock.
  generatedAt: string;
};
