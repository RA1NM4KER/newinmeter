import { AdminFeaturesPanel } from "@/components/admin/admin-features-panel";
import { getFeatureRolloutSummaries, toFeatureSummaryPayload } from "@/lib/features";
import { listAllAuthUsers } from "@/lib/user-roles";

export const dynamic = "force-dynamic";

export default async function AdminFeaturesPage() {
  const authUsers = await listAllAuthUsers();
  const summaries = await getFeatureRolloutSummaries(authUsers.map((user) => user.userId));

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <AdminFeaturesPanel initialData={{ features: toFeatureSummaryPayload(summaries) }} />
    </div>
  );
}
