import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { getAuthenticatedSession } from "@/lib/auth/session";
import { getConnectionForUser } from "@/lib/newinmeter/connection";
import { loadDashboardDailyRollups, loadDashboardHourlyRollups, loadDashboardSummary } from "@/lib/dashboard-data";
import { getOrCreateUserPermissions } from "@/lib/user-roles";

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

  const [summary, permissions] = await Promise.all([
    loadDashboardSummary(session.accessToken),
    getOrCreateUserPermissions(session.userId)
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
      isAiAssistantEnabled={permissions.aiAssistantEnabled}
      isActivitiesEnabled={permissions.activitiesEnabled}
    />
  );
}
