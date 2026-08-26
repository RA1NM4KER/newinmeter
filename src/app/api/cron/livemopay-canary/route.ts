import { NextResponse } from "next/server";
import { executeDailyCanary } from "@/lib/diagnostics/canary-job";
import { getCronSecret } from "@/lib/env";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  const expected = getCronSecret();
  if (request.headers.get("authorization") !== `Bearer ${expected}`) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }

  const result = await executeDailyCanary();
  return NextResponse.json(
    { ok: result.status !== "critical", ...result },
    { status: result.status === "critical" ? 503 : 200 }
  );
}
