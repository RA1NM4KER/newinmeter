import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { getAuthenticatedSession } from "@/lib/auth/session";
import { getUserFeatureAccessDetailed } from "@/lib/features";
import { getConnectionForUser } from "@/lib/newinmeter/connection";
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

  // The (app) layout already substitutes a blurred skeleton for this page's
  // own output when data isn't warm, but that substitution only changes
  // what's displayed, not whether this component's own body runs -- Next
  // still executes this Server Component to produce that discarded output.
  // energy_hourly_rollups (queried by loadDashboardHourlyRollups) is one of
  // the tables cold storage's purge actually empties, so skip the real
  // fetch entirely rather than querying data that's gone (or about to be
  // restored) and rendering something the layout won't even show.
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

  return (
    <DashboardShell
      dailyRows={dailyRows}
      hourlyRows={hourlyRows}
      summary={summary}
      isAiAssistantEnabled={features.ai.enabled}
      isActivitiesEnabled={features.activities.enabled}
      isAlertsEnabled={features.alerts.enabled}
      isDemo={connection.isDemo}
    />
  );
}
