import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth/session";
import { getFeatureRolloutSummaries, toFeatureSummaryPayload } from "@/lib/features";
import { listAllAuthUsers } from "@/lib/user-roles";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Features tab: one row per feature, with EFFECTIVE access counts (rollout +
// overrides resolved), not raw override-row counts.
export async function GET() {
  const auth = await requireAdminSession();
  if (!auth.ok) {
    return NextResponse.json(
      { message: auth.status === 401 ? "Authentication required." : "Admin access required." },
      { status: auth.status }
    );
  }

  const users = await listAllAuthUsers();
  const summaries = await getFeatureRolloutSummaries(users.map((user) => user.userId));

  return NextResponse.json({ features: toFeatureSummaryPayload(summaries) });
}
