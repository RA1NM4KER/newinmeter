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

  return <DataPageClient />;
}
