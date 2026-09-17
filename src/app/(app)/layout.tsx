import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { QueryProvider } from "@/components/providers/query-provider";
import { RestorationOverlay } from "@/components/restoration/restoration-overlay";
import { getAuthenticatedSession } from "@/lib/auth/session";
import { getUserFeatureAccessDetailed } from "@/lib/features";
import { getUnreadNotificationCount } from "@/lib/newinmeter/alerts";
import { getConnectionForUser } from "@/lib/newinmeter/connection";
import { getOrCreateUserPermissions } from "@/lib/user-roles";
import type { ReactNode } from "react";
import DashboardLoading from "./(dashboard)/loading";

export default async function AppGroupLayout({ children }: { children: ReactNode }) {
  const session = await getAuthenticatedSession();
  if (!session) {
    redirect("/login");
  }

  const earlyConnection = await getConnectionForUser(session.userId);
  if (!earlyConnection) {
    redirect("/connect");
  }

  // A non-warm connection (cold-storage restoring, or hibernating) no
  // longer bounces to a separate /restore route -- it renders the dashboard
  // shell right here, with a generic loading skeleton standing in for real
  // page content (never the real children: those read real energy_rows/
  // interval data that a cold connection has had purged, and every page
  // under this layout has only ever been exercised assuming a warm
  // connection) and a RestorationOverlay on top. Only checked here, so a
  // brand-new user still never sees a flash of dashboard chrome before
  // being bounced to /connect below.
  const needsRestoration = earlyConnection.dataState !== "warm";
  if (!needsRestoration && earlyConnection.status !== "connected") {
    redirect("/connect");
  }

  // Seeded server-side so the header bell's badge is correct on first
  // paint, no client-fetch flash. Same resilience posture as Settings'
  // alert rules fetch: a failure here (e.g. before this feature's
  // migration is applied) must not take down the whole authenticated app
  // shell, just start the badge at 0 until the bell's own client fetch
  // corrects it.
  const connection = earlyConnection;
  const [permissions, features, initialUnreadNotificationCount] = await Promise.all([
    getOrCreateUserPermissions(session.userId),
    getUserFeatureAccessDetailed(session.userId),
    getUnreadNotificationCount(session.userId).catch((error) => {
      console.error("newinmeter_get_unread_count_failed", error instanceof Error ? error.message : error);
      return 0;
    })
  ]);

  return (
    <QueryProvider>
      <div className={needsRestoration ? "pointer-events-none select-none blur-sm" : undefined} inert={needsRestoration}>
        <AppShell
          userId={session.userId}
          userEmail={session.email}
          isAdmin={permissions.role === "admin"}
          isActivitiesEnabled={features.activities.enabled}
          isLiveMeterEnabled={features.live.enabled}
          isAiAssistantEnabled={features.ai.enabled}
          isAlertsEnabled={features.alerts.enabled}
          isDemo={connection.isDemo}
          initialUnreadNotificationCount={initialUnreadNotificationCount}
        >
          {needsRestoration ? <DashboardLoading /> : children}
        </AppShell>
      </div>
      {needsRestoration ? (
        <RestorationOverlay
          initialState={connection.dataState}
          initialError={connection.restoreError}
          reconnectRequired={connection.status !== "connected"}
        />
      ) : null}
    </QueryProvider>
  );
}
