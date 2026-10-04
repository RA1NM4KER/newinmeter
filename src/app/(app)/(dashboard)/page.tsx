import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { getAuthenticatedSession } from "@/lib/auth/session";
import { getUserFeatureAccessDetailed } from "@/lib/features";
import { getConnectionForUser } from "@/lib/newinmeter/connection";
import { getAlertRulesForUser } from "@/lib/newinmeter/alerts";
import { getFeatureAdoption, getFeatureAdoptionRates } from "@/lib/newinmeter/feature-adoption";
import { promptDayKey } from "@/lib/dashboard-prompts";
import { loadDashboardDailyRollups, loadDashboardHourlyRollups, loadDashboardSummary } from "@/lib/dashboard-data";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await getAuthenticatedSession();
  if (!session) {
    redirect("/login");
  }

  const connection = await getConnectionForUser(session.userId);
  if (!connection || connection.status !== "connected") {
    redirect("/connect");
  }

  if (connection.dataState !== "warm") {
    return null;
  }

  const [summary, features] = await Promise.all([
    loadDashboardSummary(session.accessToken),
    getUserFeatureAccessDetailed(session.userId)
  ]);
  const [dailyRows, hourlyRows] = await Promise.all([
    loadDashboardDailyRollups(session.accessToken),
    loadDashboardHourlyRollups(session.accessToken)
  ]);
  // Rules decide which alert prompts are already covered, so they are only
  // needed when the feature is available. A failed read falls back to no
  // rules, which means prompts may show for an alert the user already set up.
  // That is a nudge, not a correctness problem, so the dashboard still renders.
  const alertRules = features.alerts.enabled
    ? await getAlertRulesForUser(session.userId).catch((error) => {
        console.error("newinmeter_dashboard_alert_rules_failed", error instanceof Error ? error.message : error);
        return [];
      })
    : [];

  // Whether AI or Activities has ever been used decides which feature to
  // promote next. Only read when one of them could be promoted at all.
  const featureAdoption =
    features.ai.enabled || features.activities.enabled ? await getFeatureAdoption(session.userId, connection.id) : null;

  // Live adoption shares (cached hourly) weight which prompt is picked, so less
  // adopted features surface more often. A failed read leaves the rates empty,
  // which weights every feature equally rather than hiding any of them.
  const featureRates = await getFeatureAdoptionRates().catch((error) => {
    console.error("newinmeter_dashboard_adoption_rates_failed", error instanceof Error ? error.message : error);
    return {};
  });

  return (
    <DashboardShell
      featureRates={featureRates}
      promptDay={promptDayKey()}
      dailyRows={dailyRows}
      hourlyRows={hourlyRows}
      summary={summary}
      alertRules={alertRules}
      featureAdoption={featureAdoption}
      isAiAssistantEnabled={features.ai.enabled}
      isActivitiesEnabled={features.activities.enabled}
      isAlertsEnabled={features.alerts.enabled}
      isDemo={connection.isDemo}
    />
  );
}
