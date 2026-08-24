// Pure constants/types shared between the server-only alert evaluator
// (alerts.ts) and client Settings components (AlertRuleRow, AlertsTab).
// Deliberately no "server-only" import and no Supabase/DB code here -- a
// client component can safely import this module directly.

export type AlertType = "low_balance" | "daily_spend" | "daily_kwh" | "data_delayed";

export const ALERT_TYPES: AlertType[] = ["low_balance", "daily_spend", "daily_kwh", "data_delayed"];

// The three types that need fresh LiveMopay data to mean anything -- gated
// on auto_sync_enabled (see upsertAlertRule/disableFreshDataAlertRules in
// alerts.ts). data_delayed is deliberately excluded: it's evaluated
// independently in the stale-check cron regardless of auto-sync state, and
// it's the one alert specifically *about* sync health, so tying it to
// auto-sync being on would be circular.
export const FRESH_DATA_ALERT_TYPES: AlertType[] = ["low_balance", "daily_spend", "daily_kwh"];

// Suggested starting thresholds shown when a user first enables an alert
// with no threshold chosen yet. Not enforced or persisted until the user
// actually saves the rule.
export const DEFAULT_THRESHOLDS: Record<Exclude<AlertType, "data_delayed">, number> = {
  low_balance: 200,
  daily_spend: 50,
  daily_kwh: 10
};

// Mirrors alert_rules_threshold_by_type in the migration -- checked
// server-side too so a bad request returns a clean 400 before ever reaching
// Postgres.
export const THRESHOLD_BOUNDS: Record<Exclude<AlertType, "data_delayed">, { min: number; max: number }> = {
  low_balance: { min: 0, max: 1_000_000 },
  daily_spend: { min: 0, max: 1_000_000 },
  daily_kwh: { min: 0, max: 10_000 }
};
