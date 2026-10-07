import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth/session";
import { limitUserRequest } from "@/lib/rate-limit";
import { getSystemMapSnapshot } from "@/lib/system-map/data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const privateHeaders = { "Cache-Control": "private, no-store" };

export async function GET() {
  const auth = await requireAdminSession();
  if (!auth.ok)
    return NextResponse.json(
      { message: auth.status === 401 ? "Authentication required." : "Admin access required." },
      { status: auth.status, headers: privateHeaders }
    );
  const rate = await limitUserRequest(auth.session.userId, "admin-system", "systemMap");
  if (rate.response) {
    rate.response.headers.set("Cache-Control", "private, no-store");
    return rate.response;
  }
  try {
    return NextResponse.json(await getSystemMapSnapshot(), { headers: { ...rate.headers, ...privateHeaders } });
  } catch {
    // Backend exceptions can include query details. The client needs only a
    // retryable unavailable state, never the raw database response.
    return NextResponse.json(
      { message: "System health is temporarily unavailable." },
      { status: 503, headers: { ...rate.headers, ...privateHeaders } }
    );
  }
}
