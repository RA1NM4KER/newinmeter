import { redirect } from "next/navigation";
import { ActivitiesPageClient } from "@/components/activities/activities-page-client";
import { getAuthenticatedSession } from "@/lib/auth/session";
import { loadDashboardSummary } from "@/lib/dashboard-data";
import { getConnectionForUser } from "@/lib/newinmeter/connection";
import { getOrCreateUserPermissions } from "@/lib/user-roles";

export const dynamic = "force-dynamic";

export default async function ActivitiesPage() {
  const session = await getAuthenticatedSession();
  if (!session) redirect("/login");
  const connection = await getConnectionForUser(session.userId);
  if (!connection || connection.status !== "connected") redirect("/connect");
  const permissions = await getOrCreateUserPermissions(session.userId);
  if (!permissions.activitiesEnabled) redirect("/");
  const summary = await loadDashboardSummary(session.accessToken);
  return <ActivitiesPageClient bounds={{ from: summary.dateStart, to: summary.dateEnd }} summary={summary} />;
}
