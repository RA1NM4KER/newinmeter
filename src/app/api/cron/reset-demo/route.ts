import { NextResponse } from "next/server";
import { getCronSecret, getNewinmeterDemoEmail } from "@/lib/env";
import { resetDemoAccount } from "@/lib/demo/reset";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Reseeding ~10 weeks of synthetic data plus rollups is the same amount of
// work as the manual CLI seed -- give it the same headroom as the other
// data-heavy cron (stale-check).
export const maxDuration = 60;

// Invoked by Vercel Cron (schedule in vercel.json). The public "Explore
// demo" button (see /api/demo-login) intentionally leaves Activities and
// notification read-state mutable for every visitor -- this daily reset is
// what keeps the shared walkthrough from drifting away from its canonical
// state, without having to make the demo read-only. A misconfigured or
// missing NEWINMETER_DEMO_EMAIL is a no-op, not an error: the public demo
// button already refuses to work in that case (see /api/demo-login), so
// there's nothing here to reset.
export async function GET(request: Request) {
  const expected = getCronSecret();
  const provided = request.headers.get("authorization");
  if (provided !== `Bearer ${expected}`) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }

  const demoEmail = getNewinmeterDemoEmail();
  if (!demoEmail) {
    return NextResponse.json({ ok: true, skipped: "NEWINMETER_DEMO_EMAIL not configured" });
  }

  try {
    const summary = await resetDemoAccount(demoEmail);
    return NextResponse.json({ ok: true, ...summary });
  } catch (error) {
    console.error("demo_reset_failed", error instanceof Error ? error.message : "unknown_error");
    return NextResponse.json({ ok: false, message: "Could not reset the demo account." }, { status: 500 });
  }
}
