import { z } from "zod";
import { listRecentResolvedSystemEvents, sanitizeDiagnosticMessage } from "@/lib/diagnostics/store";
import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth/session";
import { getDiagnosticsSnapshot } from "@/lib/diagnostics/data";
import { limitUserRequest } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await requireAdminSession();
  if (!auth.ok) {
    return NextResponse.json(
      { message: auth.status === 401 ? "Authentication required." : "Admin access required." },
      { status: auth.status }
    );
  }
  const rate = await limitUserRequest(auth.session.userId, "admin-diagnostics");
  if (rate.response) return rate.response;

  const params = new URL(request.url).searchParams;
  if (params.get("section") === "connections") {
    const parsed = z
      .array(z.string().uuid())
      .min(1)
      .max(100)
      .safeParse((params.get("ids") ?? "").split(","));
    if (!parsed.success) return NextResponse.json({ message: "Invalid connection IDs." }, { status: 400 });
    const snapshot = await getDiagnosticsSnapshot(new Date(), {
      connectionIds: parsed.data,
      overview: false,
      ...(params.get("details") === "false" ? { details: false } : {})
    });
    return NextResponse.json(snapshot.connections, { headers: rate.headers });
  }
  if (params.get("section") === "resolved") {
    const events = await listRecentResolvedSystemEvents();
    return NextResponse.json(
      events.map((event) => ({
        id: event.id,
        createdAt: event.createdAt,
        severity: event.severity,
        category: event.category,
        eventType: event.eventType,
        connectionId: event.connectionId,
        message: sanitizeDiagnosticMessage(event.message),
        resolvedAt: event.resolvedAt
      })),
      { headers: rate.headers }
    );
  }
  return NextResponse.json(await getDiagnosticsSnapshot(), { headers: rate.headers });
}
