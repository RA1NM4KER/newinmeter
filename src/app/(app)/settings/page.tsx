import { redirect } from "next/navigation";
import { SettingsPageClient } from "@/components/settings/settings-page-client";
import { getAuthenticatedSession } from "@/lib/auth/session";
import {
  getAlertInsights,
  getAlertRulesForUser,
  getLatestBalanceForUser,
  getSuggestedMonthlyBudget
} from "@/lib/newinmeter/alerts";
import { getConnectionForUser } from "@/lib/newinmeter/connection";

export const dynamic = "force-dynamic";

// Unlike the dashboard/data pages, Settings is reachable even without an
// active connection -- someone who disconnected still needs a place to
// reconnect, check their account, or sign out.
export default async function SettingsPage() {
  const session = await getAuthenticatedSession();
  if (!session) {
    redirect("/login");
  }

  const [connection, alertRules, latestBalance, insights, suggestedMonthlyBudget] = await Promise.all([
    getConnectionForUser(session.userId),
    // Alert rules are a genuinely optional part of this page -- General,
    // Data & Sync, and Account all render fine with none. Falling back to
    // an empty list rather than letting a failure here take down the whole
    // page (e.g. before the alert_rules migration has been applied, or any
    // transient DB hiccup) matches how Settings has always tolerated a
    // missing connection.
    getAlertRulesForUser(session.userId).catch((error) => {
      console.error("newinmeter_get_alert_rules_failed", error instanceof Error ? error.message : error);
      return [];
    }),
    // Purely a display hint on the low_balance row -- never worth failing
    // the page over.
    getLatestBalanceForUser(session.userId).catch((error) => {
      console.error("newinmeter_get_latest_balance_failed", error instanceof Error ? error.message : error);
      return null;
    }),
    // Backs every v2 row's secondary insight line -- same "never fail the
    // page" tolerance as the reads above.
    getAlertInsights(session.userId).catch((error) => {
      console.error("newinmeter_get_alert_insights_failed", error instanceof Error ? error.message : error);
      return null;
    }),
    getSuggestedMonthlyBudget(session.userId).catch((error) => {
      console.error("newinmeter_get_suggested_monthly_budget_failed", error instanceof Error ? error.message : error);
      return null;
    })
  ]);

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
      alertRules={alertRules}
      latestBalance={latestBalance}
      insights={insights}
      suggestedMonthlyBudget={suggestedMonthlyBudget}
      hasTariffProfile={connection?.tariffProfile != null}
    />
  );
}
