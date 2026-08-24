import { redirect } from "next/navigation";
import { SettingsPageClient } from "@/components/settings/settings-page-client";
import { getAuthenticatedSession } from "@/lib/auth/session";
import { hasFeatureAccess } from "@/lib/features";
import {
  getAlertInsights,
  getAlertRulesForUser,
  getLatestBalanceForUser,
  getSuggestedMonthlyBudget,
  type AlertInsights,
  type AlertRule
} from "@/lib/newinmeter/alerts";
import { getConnectionForUser } from "@/lib/newinmeter/connection";

export const dynamic = "force-dynamic";

type AlertData = {
  alertRules: AlertRule[];
  latestBalance: number | null;
  insights: AlertInsights | null;
  suggestedMonthlyBudget: number | null;
};

// Alerts is a fully revocable feature -- while off, none of this gets
// fetched at all, so a revoked user's Settings page never touches alert
// data. Existing rules/history are left untouched in the DB either way;
// only the read is skipped.
async function loadAlertData(userId: string): Promise<AlertData> {
  const [alertRules, latestBalance, insights, suggestedMonthlyBudget] = await Promise.all([
    // Alert rules are a genuinely optional part of this page -- General,
    // Data & Sync, and Account all render fine with none. Falling back to an
    // empty list rather than letting a failure here take down the whole page
    // (e.g. before the alert_rules migration has been applied, or any
    // transient DB hiccup) matches how Settings has always tolerated a
    // missing connection.
    getAlertRulesForUser(userId).catch((error) => {
      console.error("newinmeter_get_alert_rules_failed", error instanceof Error ? error.message : error);
      return [];
    }),
    // Purely a display hint on the low_balance row -- never worth failing
    // the page over.
    getLatestBalanceForUser(userId).catch((error) => {
      console.error("newinmeter_get_latest_balance_failed", error instanceof Error ? error.message : error);
      return null;
    }),
    // Backs every v2 row's secondary insight line -- same "never fail the
    // page" tolerance as the reads above.
    getAlertInsights(userId).catch((error) => {
      console.error("newinmeter_get_alert_insights_failed", error instanceof Error ? error.message : error);
      return null;
    }),
    getSuggestedMonthlyBudget(userId).catch((error) => {
      console.error("newinmeter_get_suggested_monthly_budget_failed", error instanceof Error ? error.message : error);
      return null;
    })
  ]);

  return { alertRules, latestBalance, insights, suggestedMonthlyBudget };
}

// Unlike the dashboard/data pages, Settings is reachable even without an
// active connection -- someone who disconnected still needs a place to
// reconnect, check their account, or sign out.
export default async function SettingsPage() {
  const session = await getAuthenticatedSession();
  if (!session) {
    redirect("/login");
  }

  const [connection, alertsEnabled] = await Promise.all([
    getConnectionForUser(session.userId),
    hasFeatureAccess(session.userId, "alerts")
  ]);

  const { alertRules, latestBalance, insights, suggestedMonthlyBudget } = alertsEnabled
    ? await loadAlertData(session.userId)
    : { alertRules: [], latestBalance: null, insights: null, suggestedMonthlyBudget: null };

  const initial = (session.email ?? "?").trim().charAt(0).toUpperCase() || "?";

  return (
    <SettingsPageClient
      userEmail={session.email}
      avatarInitial={initial}
      connection={{
        status: connection?.status ?? "not_connected",
        livemopayEmail: connection?.livemopayEmail ?? null,
        accountLabel: connection?.accountLabel ?? null,
        lastSyncedAt: connection?.lastSyncedAt ?? null,
        isDemo: connection?.isDemo ?? false,
        autoSyncEnabled: connection?.autoSyncEnabled ?? true,
        nextSyncAt: connection?.nextSyncAt ?? null
      }}
      alertsEnabled={alertsEnabled}
      alertRules={alertRules}
      latestBalance={latestBalance}
      insights={insights}
      suggestedMonthlyBudget={suggestedMonthlyBudget}
      hasTariffProfile={connection?.tariffProfile != null}
    />
  );
}
