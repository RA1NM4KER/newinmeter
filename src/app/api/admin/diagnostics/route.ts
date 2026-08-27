import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth/session";
import { getDiagnosticsSnapshot } from "@/lib/diagnostics/data";
import { limitUserRequest } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const auth = await requireAdminSession();
  if (!auth.ok) {
    return NextResponse.json(
      { message: auth.status === 401 ? "Authentication required." : "Admin access required." },
      { status: auth.status }
    );
  }
  const rate = await limitUserRequest(auth.session.userId, "admin-diagnostics");
  if (rate.response) return rate.response;

  return NextResponse.json(await getDiagnosticsSnapshot(), { headers: rate.headers });
}
