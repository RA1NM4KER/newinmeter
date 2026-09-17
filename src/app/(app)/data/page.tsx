import { redirect } from "next/navigation";
import { DataPageClient } from "@/components/data/data-page-client";
import { getAuthenticatedSession } from "@/lib/auth/session";
import { getConnectionForUser } from "@/lib/newinmeter/connection";

export const dynamic = "force-dynamic";

export default async function DataPage() {
  const session = await getAuthenticatedSession();
  if (!session) {
    redirect("/login");
  }

  const connection = await getConnectionForUser(session.userId);
  if (!connection || connection.status !== "connected") {
    redirect("/connect");
  }
  // See the (app) layout's own comment: only "/" gets a blurred-skeleton
  // substitution for non-warm data, every other route still redirects
  // itself, now to "/" (which shows the restoration overlay) instead of the
  // old dedicated /restore route. DataPageClient reads raw energy_rows via
  // /api/energy-rows client-side, one of the tables cold storage purges.
  if (connection.dataState !== "warm") {
    redirect("/");
  }

  return <DataPageClient isDemo={connection.isDemo} />;
}
