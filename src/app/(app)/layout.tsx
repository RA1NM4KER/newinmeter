import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { QueryProvider } from "@/components/providers/query-provider";
import { getAuthenticatedSession } from "@/lib/auth/session";
import { getUserFeatureAccessDetailed } from "@/lib/features";
import { getUnreadNotificationCount } from "@/lib/newinmeter/alerts";
import { getConnectionForUser } from "@/lib/newinmeter/connection";
import { getOrCreateUserPermissions } from "@/lib/user-roles";
import type { ReactNode } from "react";

export default async function AppGroupLayout({ children }: { children: ReactNode }) {
  const session = await getAuthenticatedSession();
  if (!session) {
    redirect("/login");
  }

  // Seeded server-side so the header bell's badge is correct on first
  // paint, no client-fetch flash. Same resilience posture as Settings'
  // alert rules fetch: a failure here (e.g. before this feature's
  // migration is applied) must not take down the whole authenticated app
  // shell, just start the badge at 0 until the bell's own client fetch
  // corrects it.
  const [permissions, features, connection, initialUnreadNotificationCount] = await Promise.all([
    getOrCreateUserPermissions(session.userId),
    getUserFeatureAccessDetailed(session.userId),
    getConnectionForUser(session.userId),
    getUnreadNotificationCount(session.userId).catch((error) => {
      console.error("newinmeter_get_unread_count_failed", error instanceof Error ? error.message : error);
      return 0;
    })
  ]);

  return (
    <QueryProvider>
      <AppShell
        userEmail={session.email}
        isAdmin={permissions.role === "admin"}
        isActivitiesEnabled={features.activities.enabled}
        isLiveMeterEnabled={features.live.enabled}
        isAiAssistantEnabled={features.ai.enabled}
        isAlertsEnabled={features.alerts.enabled}
        isDemo={connection?.isDemo ?? false}
        initialUnreadNotificationCount={initialUnreadNotificationCount}
      >
        {children}
      </AppShell>
    </QueryProvider>
  );
}
