import { redirect } from "next/navigation";
import { ActivitiesPageClient } from "@/components/activities/activities-page-client";
import { getAuthenticatedSession } from "@/lib/auth/session";
import { loadDashboardSummary } from "@/lib/dashboard-data";
import { hasFeatureAccess } from "@/lib/features";
import { getConnectionForUser } from "@/lib/newinmeter/connection";

export const dynamic = "force-dynamic";

export default async function ActivitiesPage() {
  const session = await getAuthenticatedSession();
  if (!session) redirect("/login");
  const connection = await getConnectionForUser(session.userId);
  if (!connection || connection.status !== "connected") redirect("/connect");
  // The (app) layout only swaps the homepage's own output for a blurred
  // skeleton when data isn't warm, every other route still executes and
  // renders normally underneath that blur unless it redirects itself, see
  // the (app) layout's own comment. "/" now shows the restoration overlay
  // for a non-warm connection, so redirect there instead of rendering
  // Activities against interval rollups that may have just been purged.
  if (connection.dataState !== "warm") redirect("/");
  const activitiesEnabled = await hasFeatureAccess(session.userId, "activities");
  if (!activitiesEnabled) redirect("/");
  const summary = await loadDashboardSummary(session.accessToken);
  return <ActivitiesPageClient bounds={{ from: summary.dateStart, to: summary.dateEnd }} summary={summary} />;
}
