import { notFound } from "next/navigation";
import { AdminPageClient } from "@/components/admin/admin-page-client";
import { requireAdminSession } from "@/lib/auth/session";
import { getFeatureRolloutSummaries, toFeatureSummaryPayload } from "@/lib/features";
import { listAllAuthUsers, listAllUserPermissions } from "@/lib/user-roles";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const auth = await requireAdminSession();
  if (!auth.ok) {
    notFound();
  }

  const [rows, authUsers] = await Promise.all([listAllUserPermissions(), listAllAuthUsers()]);
  const summaries = await getFeatureRolloutSummaries(authUsers.map((user) => user.userId));

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 pt-6">
      <div className="hidden shrink-0 sm:block">
        <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">Admin</h1>
        <p className="mt-1 text-sm text-muted">Manage user access and feature rollout.</p>
      </div>

      <AdminPageClient
        currentUserId={auth.session.userId}
        initialUsers={{ rows, total: rows.length }}
        initialFeatures={{ features: toFeatureSummaryPayload(summaries) }}
      />
    </div>
  );
}
