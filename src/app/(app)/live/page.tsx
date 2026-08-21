import { notFound, redirect } from "next/navigation";
import { LivePageClient } from "@/components/live/live-page-client";
import { getAuthenticatedSession } from "@/lib/auth/session";
import { getConnectionForUser } from "@/lib/newinmeter/connection";
import { getOrCreateUserPermissions } from "@/lib/user-roles";
import { resolveLiveAccess } from "./access";

export const dynamic = "force-dynamic";

export default async function LivePage() {
  const session = await getAuthenticatedSession();

  // Resolve permission + connection only when there is a session, then let the
  // pure resolver decide the outcome (kept in access.ts for testability).
  const permissions = session ? await getOrCreateUserPermissions(session.userId) : null;
  const connection = session ? await getConnectionForUser(session.userId) : null;

  const access = resolveLiveAccess({
    hasSession: Boolean(session),
    liveMeterEnabled: Boolean(permissions?.liveMeterEnabled),
    isConnected: connection?.status === "connected"
  });

  // Feature invisibility: an authenticated user without the permission gets a
  // genuine 404 -- the page behaves as though it does not exist.
  if (access === "login") redirect("/login");
  if (access === "notFound") notFound();
  if (access === "connect") redirect("/connect");

  return <LivePageClient userId={session?.userId ?? null} />;
}
