import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { ConnectForm } from "@/components/connect/connect-form";
import { getAuthenticatedSession } from "@/lib/auth/session";
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

  return (
    <AuthShell
      badge="Step 2 of 2"
      title={<>Link your LiveMopay account</>}
      description="We sign in once to pull your ledger, then throw the password away and keep only an encrypted refresh token."
    >
      <ConnectForm defaultEmail={session.email ?? ""} initialPendingAccounts={initialPendingAccounts} />
    </AuthShell>
  );
}
