import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { RestorationStatus } from "@/components/restoration/restoration-status";
import { getAuthenticatedSession } from "@/lib/auth/session";
import { getConnectionForUser } from "@/lib/newinmeter/connection";

export const dynamic = "force-dynamic";

export default async function RestorePage() {
  const session = await getAuthenticatedSession();
  if (!session) redirect("/login");

  const connection = await getConnectionForUser(session.userId);
  if (!connection) redirect("/connect");
  if (connection.dataState === "warm") redirect(connection.status === "connected" ? "/" : "/connect");

  return (
    <AuthShell
      variant="focused"
      badge="Restoring your dashboard"
      title={<>Welcome back</>}
      description="Your detailed meter history was safely archived after a long period away. We’re rebuilding the latest 90 days before opening the dashboard."
    >
      <RestorationStatus
        initialState={connection.dataState}
        initialError={connection.restoreError}
        reconnectRequired={connection.status !== "connected"}
      />
    </AuthShell>
  );
}
