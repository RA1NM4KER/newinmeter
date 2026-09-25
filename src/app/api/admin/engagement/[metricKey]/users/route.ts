import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth/session";
import { getActivityWindowUsers, getAdoptionMetricUsers, isActivityWindowKey, isAdoptionMetricKey } from "@/lib/engagement";
import { limitUserRequest } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Backs the Engagement tab's expandable adoption row and activity tiles,
// mirroring the Features tab's per-feature user list
// (/api/admin/features/[featureKey]/users).
export async function GET(_request: Request, { params }: { params: { metricKey: string } }) {
  const auth = await requireAdminSession();
  if (!auth.ok) {
    return NextResponse.json(
      { message: auth.status === 401 ? "Authentication required." : "Admin access required." },
      { status: auth.status }
    );
  }
  const rate = await limitUserRequest(auth.session.userId, "admin-engagement-users");
  if (rate.response) return rate.response;

  if (isAdoptionMetricKey(params.metricKey)) {
    const users = await getAdoptionMetricUsers(params.metricKey);
    return NextResponse.json({ users }, { headers: rate.headers });
  }

  if (isActivityWindowKey(params.metricKey)) {
    const users = await getActivityWindowUsers(params.metricKey);
    return NextResponse.json({ users }, { headers: rate.headers });
  }

  return NextResponse.json({ message: "Unknown metric." }, { status: 404 });
}
