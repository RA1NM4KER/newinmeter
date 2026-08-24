// Small versioned registry of known tariff structures -- not a rules
// engine. A connection optionally carries a `tariff_profile` key (see
// 20260824050000); this module is the only place that key's actual bands
// live. tariff_changed works for every connection regardless of profile
// (it's purely observational -- see evaluateTariffChanged in alerts.ts);
// only tariff_band_approaching needs a known profile, and simply isn't
// offered when one isn't set (never a fallback default -- a future
// non-Newinbosch signup gets tariff_profile = null and stays that way
// until something explicit assigns it a real profile).
//
// No server-only import here: alert-types.ts-style pure data/logic, safe
// for a client component (AlertsTab) to import directly to decide whether
// to render the band-approaching row's copy.

export type TariffBand = {
  // Inclusive lower bound, kWh for the current calendar month.
  fromKwh: number;
  // Exclusive upper bound, or null for the top (unbounded) band.
  toKwh: number | null;
  ratePerKwh: number;
};

export type TariffProfile = {
  key: string;
  label: string;
  effectiveFrom: string; // ISO date
  dailyBasicCharge: number;
  dailyReadingCharge: number;
  bands: TariffBand[];
};

// Official Newinbosch 2026/27 tariff, effective 2026-07-01. Bands are
// calendar-month kWh accumulators (the official guide describes consumption
// bands in kWh/month, not per-day or per-billing-cycle) -- see
// resolveMonthlyBand's own comment for how that's applied.
export const NEWINBOSCH_2026_27: TariffProfile = {
  key: "newinbosch_2026_27",
  label: "Newinbosch 2026/27",
  effectiveFrom: "2026-07-01",
  dailyBasicCharge: 11.41,
  dailyReadingCharge: 5.16,
  bands: [
    { fromKwh: 0, toKwh: 50, ratePerKwh: 1.72 },
    { fromKwh: 50, toKwh: 300, ratePerKwh: 2.21 },
    { fromKwh: 300, toKwh: 600, ratePerKwh: 3.11 },
    { fromKwh: 600, toKwh: null, ratePerKwh: 3.68 }
  ]
};

const TARIFF_PROFILES: Record<string, TariffProfile> = {
  [NEWINBOSCH_2026_27.key]: NEWINBOSCH_2026_27
};

export function getTariffProfile(key: string | null | undefined): TariffProfile | null {
  if (!key) return null;
  return TARIFF_PROFILES[key] ?? null;
}

export type BandPosition = {
  currentBand: TariffBand;
  // null when already in the top (unbounded) band -- there's nothing to
  // approach.
  nextThresholdKwh: number | null;
  // clamp(10% of the CURRENT band's width, 5, 25) -- see the module-level
  // comment on resolveApproachingBand for why this shape and not a
  // per-profile configurable number.
  warningDistanceKwh: number | null;
};

// Which band this month's usage falls in, and how far the next threshold
// is. Calendar-month accumulator: `monthKwh` is the sum of this SAST
// calendar month's energy kWh so far (see monthToDateEnergyKwh in
// alerts.ts) -- NOT a rolling 30-day window, matching the official guide's
// own "kWh per month" band description.
export function resolveMonthlyBand(profile: TariffProfile, monthKwh: number): BandPosition {
  const band =
    profile.bands.find((candidate) => monthKwh >= candidate.fromKwh && (candidate.toKwh === null || monthKwh < candidate.toKwh)) ??
    profile.bands[profile.bands.length - 1];

  if (band.toKwh === null) {
    return { currentBand: band, nextThresholdKwh: null, warningDistanceKwh: null };
  }

  const bandWidth = band.toKwh - band.fromKwh;
  // 10% of the current band's width, clamped to [5, 25] kWh -- see the
  // spec's own worked examples (0-50 -> 5kWh, 50-300/300-600 -> 25kWh
  // (10% of 250/300 both exceed the 25 cap)). One profile-independent rule
  // instead of a per-band or per-profile configurable number -- nothing
  // for a user to tune, nothing to explain.
  const warningDistanceKwh = Math.min(25, Math.max(5, bandWidth * 0.1));

  return { currentBand: band, nextThresholdKwh: band.toKwh, warningDistanceKwh };
}

// True once monthKwh is within warningDistanceKwh of the next band's
// threshold (but hasn't crossed it -- crossing it just means monthKwh now
// resolves into the next band on the next check, at which point band
// position naturally becomes "not approaching" again since there's a new,
// higher threshold ahead).
export function isApproachingNextBand(position: BandPosition, monthKwh: number): boolean {
  if (position.nextThresholdKwh === null || position.warningDistanceKwh === null) {
    return false;
  }
  return position.nextThresholdKwh - monthKwh <= position.warningDistanceKwh;
}
