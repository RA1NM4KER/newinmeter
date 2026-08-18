import { NextResponse } from "next/server";
import { z } from "zod";
import { requireConnectedSession } from "@/lib/auth/session";
import { loadDashboardSummary } from "@/lib/dashboard-data";
import {
  getConnectionRowForUser,
  getDecryptedRefreshToken,
  markConnectionAuthError,
  markConnectionSyncOutcome,
  replaceConnectionRefreshToken
} from "@/lib/newinmeter-connection";
import { runLivemopaySync, SyncAlreadyRunningError } from "@/lib/newinmeter-sync";
import { TokenDecryptionError } from "@/lib/token-encryption";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const syncRequestSchema = z.object({
  mode: z.enum(["incremental", "full"]).catch("incremental")
});

export async function POST(request: Request) {
  const auth = await requireConnectedSession();
  if (!auth.ok) {
    return NextResponse.json(
      { message: auth.status === 401 ? "Authentication required." : "Connect a LiveMopay account first." },
      { status: auth.status }
    );
  }

  const { session } = auth;
  // requireConnectedSession() already resolved a safe connection projection;
  // the sync needs the row's encrypted token fields too, which that
  // projection deliberately omits, so it's fetched again here.
  const connectionRow = await getConnectionRowForUser(session.userId);

  if (
    !connectionRow ||
    connectionRow.status !== "connected" ||
    !connectionRow.account_id ||
    !connectionRow.company_id ||
    !connectionRow.property_id
  ) {
    return NextResponse.json({ message: "Connect a LiveMopay account first." }, { status: 409 });
  }

  // Demo accounts never reach LiveMopay: checked before any refresh-token
  // decryption or network call, not just hidden in the UI. The dataset is
  // fixed and seeded by scripts/seed-demo-account.ts.
  if (connectionRow.is_demo) {
    return NextResponse.json(
      { message: "This account uses fixed demo data and cannot sync with LiveMopay.", demoAccount: true },
      { status: 403 }
    );
  }

  try {
    const body = syncRequestSchema.parse(await request.json().catch(() => ({})));
    const refreshToken = getDecryptedRefreshToken(connectionRow);

    const result = await runLivemopaySync({
      connectionId: connectionRow.id,
      accountId: connectionRow.account_id,
      companyId: connectionRow.company_id,
      propertyId: connectionRow.property_id,
      refreshToken,
      mode: body.mode,
      onRefreshTokenRotated: (newRefreshToken) => replaceConnectionRefreshToken(connectionRow.id, newRefreshToken)
    });

    await markConnectionSyncOutcome(connectionRow.id, null);
    const summary = await loadDashboardSummary(session.accessToken);

    return NextResponse.json({ mode: body.mode, summary, output: result.output });
  } catch (error) {
    if (error instanceof SyncAlreadyRunningError) {
      return NextResponse.json({ message: error.message }, { status: 409 });
    }

    if (error instanceof TokenDecryptionError) {
      // Not retryable -- the stored token can never decrypt successfully
      // again (see markConnectionAuthError). Flip the connection out of
      // "connected" now rather than leaving the user stuck on a sync
      // button that will fail identically forever.
      console.error("livemopay_sync_failed", error.message);
      await markConnectionAuthError(connectionRow.id).catch(() => {});
      return NextResponse.json(
        { message: "Your LiveMopay connection needs to be reconnected.", reauthRequired: true },
        { status: 409 }
      );
    }

    const message = error instanceof Error ? error.message : "Sync failed.";
    console.error("livemopay_sync_failed", message);
    await markConnectionSyncOutcome(connectionRow.id, message).catch(() => {});
    return NextResponse.json({ message: "Sync failed." }, { status: 500 });
  }
}
