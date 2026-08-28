import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { ConnectForm } from "@/components/connect/connect-form";
import { getAuthenticatedSession } from "@/lib/auth/session";
import { recordFunnelEvent } from "@/lib/funnel";
import { getNewinmeterWebPortalOrigin } from "@/lib/env";
import { getConnectionForUser } from "@/lib/newinmeter/connection";

export const dynamic = "force-dynamic";

export default async function ConnectPage() {
  const session = await getAuthenticatedSession();
  if (!session) {
    redirect("/login");
  }

  const connection = await getConnectionForUser(session.userId);
  if (connection?.status === "connected") {
    redirect("/");
  }

  const initialPendingAccounts =
    connection?.status === "pending_selection"
      ? (connection.pendingAccounts ?? []).map((account, index) => ({ index, label: account.label }))
      : null;

  await recordFunnelEvent("connect_screen_viewed");

  return (
    <AuthShell
      variant="focused"
      badge="One more step"
      title={<>Connect your LiveMopay account</>}
      description="Use the same email and password you already use to log in to LiveMopay. That's the only thing that lets NewinMeter show your electricity history."
    >
      <ConnectForm
        defaultEmail={session.email ?? ""}
        initialPendingAccounts={initialPendingAccounts}
        livemopayPortalUrl={getNewinmeterWebPortalOrigin()}
      />
    </AuthShell>
  );
}
