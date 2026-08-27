import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth/session";
import { listFeatureOverrides } from "@/lib/features";
import { isFeatureKey } from "@/lib/newinmeter/features-shared";
import { listAllAuthUsers } from "@/lib/user-roles";
import { limitUserRequest } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Every user with an explicit override on this feature (grant or revoke) --
// backs the Features tab's expandable "who has an override" list. Small by
// construction: only admin action creates rows here.
export async function GET(_request: Request, { params }: { params: { featureKey: string } }) {
  const auth = await requireAdminSession();
  if (!auth.ok) {
    return NextResponse.json(
      { message: auth.status === 401 ? "Authentication required." : "Admin access required." },
      { status: auth.status }
    );
  }
  const rate = await limitUserRequest(auth.session.userId, "admin-feature-users");
  if (rate.response) return rate.response;

  if (!isFeatureKey(params.featureKey)) {
    return NextResponse.json({ message: "Unknown feature." }, { status: 404 });
  }

  const [overrides, users] = await Promise.all([listFeatureOverrides(params.featureKey), listAllAuthUsers()]);
  const emailByUserId = new Map(users.map((user) => [user.userId, user.email]));

  const rows = overrides
    .map((override) => ({
      userId: override.userId,
      email: emailByUserId.get(override.userId) ?? null,
      enabled: override.enabled
    }))
    .sort((a, b) => (a.email ?? "").localeCompare(b.email ?? ""));

  return NextResponse.json({ users: rows }, { headers: rate.headers });
}
