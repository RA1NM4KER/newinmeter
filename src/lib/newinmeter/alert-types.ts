// Pure constants/types shared between the server-only alert evaluator
// (alerts.ts) and client Settings components (AlertRuleRow, AlertsTab).
// Deliberately no "server-only" import and no Supabase/DB code here -- a
// client component can safely import this module directly.

export type AlertType =
  | "low_balance"
  | "daily_spend"
  | "daily_kwh"
  | "data_delayed"
  | "balance_runway"
  | "monthly_budget"
  | "tariff_changed"
  | "tariff_band_approaching"
  | "usage_anomaly";

export const ALERT_TYPES: AlertType[] = [
  "low_balance",
  "daily_spend",
  "daily_kwh",
  "data_delayed",
  "balance_runway",
  "monthly_budget",
  "tariff_changed",
  "tariff_band_approaching",
  "usage_anomaly"
];

// The types with a numeric, user-configurable threshold. Everything else
// (data_delayed, tariff_changed, tariff_band_approaching, usage_anomaly) is
// either a fixed system rule or purely observational -- nothing for the
// user to tune, so no threshold input renders for them at all.
export const THRESHOLD_ALERT_TYPES: AlertType[] = ["low_balance", "daily_spend", "daily_kwh", "balance_runway", "monthly_budget"];

// The types that need fresh LiveMopay data to mean anything -- gated on
// auto_sync_enabled (see upsertAlertRule/disableFreshDataAlertRules in
// alerts.ts). data_delayed is deliberately excluded: it's evaluated
// independently in the stale-check cron regardless of auto-sync state, and
// it's the one alert specifically *about* sync health, so tying it to
// auto-sync being on would be circular.
export const FRESH_DATA_ALERT_TYPES: AlertType[] = [
  "low_balance",
  "daily_spend",
  "daily_kwh",
  "balance_runway",
  "monthly_budget",
  "tariff_changed",
  "tariff_band_approaching",
  "usage_anomaly"
];

// Suggested starting thresholds shown when a user first enables an alert
// with no threshold chosen yet. Not enforced or persisted until the user
// actually saves the rule. monthly_budget deliberately has no entry here --
// there's no universal default worth suggesting; Settings derives a
// history-based suggestion instead (getSuggestedMonthlyBudget in alerts.ts)
// or leaves the field for the user to choose.
export const DEFAULT_THRESHOLDS: Partial<Record<AlertType, number>> = {
  low_balance: 200,
  daily_spend: 50,
  daily_kwh: 10,
  balance_runway: 3
};

// Mirrors alert_rules_threshold_by_type in the migration -- checked
// server-side too so a bad request returns a clean 400 before ever reaching
// Postgres.
export const THRESHOLD_BOUNDS: Partial<Record<AlertType, { min: number; max: number }>> = {
  low_balance: { min: 0, max: 1_000_000 },
  daily_spend: { min: 0, max: 1_000_000 },
  daily_kwh: { min: 0, max: 10_000 },
  // min is exclusive (matches every other bound here: "> min"), so this
  // combined with the integer check in validateThreshold allows exactly
  // 1..30 whole days.
  balance_runway: { min: 0, max: 30 },
  monthly_budget: { min: 0, max: 1_000_000 }
};
