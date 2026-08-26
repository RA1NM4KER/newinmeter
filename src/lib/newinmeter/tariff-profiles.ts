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
  ledgerRateSchedules: TariffLedgerRateSchedule[];
};

export type TariffLedgerRateSchedule = {
  kind: TariffBandKind;
  effectiveFrom: string;
  effectiveTo?: string; // exclusive ISO date
  bands: TariffLedgerBand[];
};

export type TariffBandKind = "energy" | "water";

export type TariffLedgerBand = {
  label: string;
  // VAT-inclusive rate as stored by LiveMopay.
  rate: number;
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
  ],
  ledgerRateSchedules: [
    // LiveMopay applied this distinct four-block set during July. Production
    // ledger transitions across several connections occur at 50/300/600 kWh,
    // establishing the band correspondence without treating the rates as the
    // later official schedule.
    {
      kind: "energy",
      effectiveFrom: "2026-07-01",
      effectiveTo: "2026-08-01",
      bands: [
        { label: "0 - 50", rate: 2.3805 },
        { label: "50 - 300", rate: 3.0475 },
        { label: "300 - 600", rate: 4.301 },
        { label: "600 -", rate: 5.06 }
      ]
    },
    // Official profile rates above, including 15% VAT as supplied by the
    // ledger API from August onward.
    {
      kind: "energy",
      effectiveFrom: "2026-08-01",
      effectiveTo: "2027-07-01",
      bands: [
        { label: "0 - 50", rate: 1.978 },
        { label: "50 - 300", rate: 2.5415 },
        { label: "300 - 600", rate: 3.5765 },
        { label: "600 -", rate: 4.232 }
      ]
    },
    {
      kind: "water",
      effectiveFrom: "2026-07-01",
      effectiveTo: "2027-07-01",
      // Only rates observed and transition-verified in production are listed.
      // The 40 - 70 rate is intentionally absent until its 2026/27 value is
      // established; an explicit upstream label still resolves it.
      bands: [
        { label: "0 - 6", rate: 9.821 },
        { label: "6 - 12", rate: 14.8695 },
        { label: "12 - 20", rate: 25.1505 },
        { label: "20 - 25", rate: 44.735 },
        { label: "25 - 40", rate: 62.169 }
      ]
    }
  ]
};

const TARIFF_PROFILES: Record<string, TariffProfile> = {
  [NEWINBOSCH_2026_27.key]: NEWINBOSCH_2026_27
};

export function getTariffProfile(key: string | null | undefined): TariffProfile | null {
  if (!key) return null;
  return TARIFF_PROFILES[key] ?? null;
}

const RATE_EPSILON = 0.0001;
const EXPLICIT_BAND_RE = /^(Energy Charge|Water):\s*(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)?\s*$/i;

export function explicitTariffBand(chargeLabel: string, kind: TariffBandKind): string | null {
  const match = chargeLabel.trim().match(EXPLICIT_BAND_RE);
  if (!match) return null;
  const labelKind: TariffBandKind = match[1].toLowerCase() === "water" ? "water" : "energy";
  if (labelKind !== kind) return null;
  return `${match[2]} -${match[3] ? ` ${match[3]}` : ""}`;
}

export type TariffBandResolutionInput = {
  kind: TariffBandKind;
  chargeLabel: string;
  tariffProfile: string | null | undefined;
  periodDate: string;
  tariff: number | string;
};

// One resolver for ingestion and backfill. An explicit upstream band always
// wins; otherwise a rate is meaningful only inside its profile/date schedule.
export function resolveTariffBand(input: TariffBandResolutionInput): string | null {
  const explicit = explicitTariffBand(input.chargeLabel, input.kind);
  if (explicit) return explicit;
  const expectedPrefix = input.kind === "energy" ? "energy charge:" : "water:";
  if (!input.chargeLabel.trim().toLowerCase().startsWith(expectedPrefix)) return null;

  const profile = getTariffProfile(input.tariffProfile);
  const tariff = Number(input.tariff);
  const date = input.periodDate.slice(0, 10);
  if (!profile || !Number.isFinite(tariff) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;

  const schedule = profile.ledgerRateSchedules.find(
    (candidate) =>
      candidate.kind === input.kind &&
      date >= candidate.effectiveFrom &&
      (!candidate.effectiveTo || date < candidate.effectiveTo)
  );
  if (!schedule) return null;

  const matches = schedule.bands.filter(({ rate }) => Math.abs(rate - tariff) <= RATE_EPSILON);
  if (matches.length !== 1) return null;
  return matches[0].label;
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
    profile.bands.find(
      (candidate) => monthKwh >= candidate.fromKwh && (candidate.toKwh === null || monthKwh < candidate.toKwh)
    ) ?? profile.bands[profile.bands.length - 1];

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
