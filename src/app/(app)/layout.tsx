import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { QueryProvider } from "@/components/providers/query-provider";
import { getAuthenticatedSession } from "@/lib/auth/session";
import { getConnectionForUser } from "@/lib/newinmeter/connection";
import { getOrCreateUserPermissions } from "@/lib/user-roles";
import type { ReactNode } from "react";

export default async function AppGroupLayout({ children }: { children: ReactNode }) {
  const session = await getAuthenticatedSession();
  if (!session) {
    redirect("/login");
  }

  const [permissions, connection] = await Promise.all([
    getOrCreateUserPermissions(session.userId),
    getConnectionForUser(session.userId)
  ]);

  return (
    <QueryProvider>
      <AppShell
        userEmail={session.email}
        isAdmin={permissions.role === "admin"}
        isActivitiesEnabled={permissions.activitiesEnabled}
        isLiveMeterEnabled={permissions.liveMeterEnabled}
        isDemo={connection?.isDemo ?? false}
      >
        {children}
      </AppShell>
    </QueryProvider>
  );
}
