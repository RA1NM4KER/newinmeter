import { NextResponse } from "next/server";
import { getAuthenticatedSession } from "@/lib/auth/session";
import { getAlertRulesForUser } from "@/lib/newinmeter/alerts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Returns only the rules the user has actually configured (0-9 rows) --
// the client fills gaps with DEFAULT_THRESHOLDS and enabled: false, so an
// untouched alert never gets a row written just from viewing Settings.
export async function GET() {
  const session = await getAuthenticatedSession();
  if (!session) {
    return NextResponse.json({ message: "Authentication required." }, { status: 401 });
  }

  const rules = await getAlertRulesForUser(session.userId);
  return NextResponse.json({ rules });
}
