import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { getAuthenticatedSession } from "@/lib/auth/session";
import { getUserFeatureAccessDetailed } from "@/lib/features";
import { getConnectionForUser } from "@/lib/newinmeter/connection";

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

  const features = await getUserFeatureAccessDetailed(session.userId);

  return (
    <DashboardShell
      userId={session.userId}
      revision={connection.lastSyncedAt ?? "never"}
      isAiAssistantEnabled={features.ai.enabled}
      isActivitiesEnabled={features.activities.enabled}
      isAlertsEnabled={features.alerts.enabled}
      isDemo={connection.isDemo}
    />
  );
}
