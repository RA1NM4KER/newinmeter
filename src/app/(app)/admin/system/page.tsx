import { notFound } from "next/navigation";
import { requireAdminSession } from "@/lib/auth/session";
import { getSystemMapSnapshot } from "@/lib/system-map/data";
import { SystemMapPage } from "@/components/admin/system-map/system-map-page";

export const dynamic = "force-dynamic";

export default async function AdminSystemPage() {
  const auth = await requireAdminSession();
  if (!auth.ok) notFound();
  const snapshot = await getSystemMapSnapshot().catch(() => null);
  return <SystemMapPage initialSnapshot={snapshot} />;
}
