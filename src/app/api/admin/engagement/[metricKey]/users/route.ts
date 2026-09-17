import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth/session";
import { getAdoptionMetricUsers, isAdoptionMetricKey } from "@/lib/engagement";
import { limitUserRequest } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Backs the Engagement tab's expandable adoption row, mirroring the Features
// tab's per-feature user list (/api/admin/features/[featureKey]/users).
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

  if (!isAdoptionMetricKey(params.metricKey)) {
    return NextResponse.json({ message: "Unknown metric." }, { status: 404 });
  }

  const users = await getAdoptionMetricUsers(params.metricKey);
  return NextResponse.json({ users }, { headers: rate.headers });
}
