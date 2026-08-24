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
    />
  );
}
