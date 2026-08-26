import { notFound } from "next/navigation";
import { EngagementPanel } from "@/components/admin/engagement-panel";
import { requireAdminSession } from "@/lib/auth/session";
import { getEngagementMetrics } from "@/lib/engagement";

export const dynamic = "force-dynamic";

export default async function AdminEngagementPage() {
  const auth = await requireAdminSession();
  if (!auth.ok) notFound();

  const metrics = await getEngagementMetrics();
  return <EngagementPanel metrics={metrics} />;
}
