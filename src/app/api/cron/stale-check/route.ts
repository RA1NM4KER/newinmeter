import { NextResponse } from "next/server";
import { getCronSecret } from "@/lib/env";
import { evaluateDataDelayedAlerts } from "@/lib/newinmeter/alerts";
import { listConnectionsForStaleCheck, markConnectionStaleNotified } from "@/lib/newinmeter/connection";
import { sendPushToUser } from "@/lib/push-notify";
import { isSyncStale } from "@/lib/sync-status";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// One pass can touch every connected account; give it room beyond the old
// serverless default. Vercel Functions allow up to 300s.
export const maxDuration = 60;

// Invoked by Vercel Cron (schedule in vercel.json). Sends a "your data looks
// stale" push at most once per stale episode per user -- dedupe lives on the
// connection's stale_notified_at, set here and cleared on the next successful
// sync. The cron cadence is only detection resolution, not notification rate.
export async function GET(request: Request) {
  const expected = getCronSecret();
  const provided = request.headers.get("authorization");
  if (provided !== `Bearer ${expected}`) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }

  const connections = await listConnectionsForStaleCheck();

  let notified = 0;
  let skipped = 0;

  for (const connection of connections) {
    const stale = isSyncStale(connection.lastSyncedAt);

    // Only the fresh -> stale transition notifies. Already-notified (flag set)
    // or still-fresh connections are left alone; the flag is reset elsewhere,
    // on the next successful sync.
    if (!stale || connection.staleNotifiedAt !== null) {
      skipped += 1;
      continue;
    }

    const reached = await sendPushToUser(connection.userId, {
      title: "NewinMeter",
      body: "Your usage data looks stale. Open the app to sync.",
      url: "/data"
    });

    // Mark as notified even when no device was reached (no active
    // subscription): there's nothing to deliver, and we don't want to retry a
    // user with no subscriptions every single run.
    await markConnectionStaleNotified(connection.id);

    if (reached > 0) {
      notified += 1;
    } else {
      skipped += 1;
    }
  }

  // Separate from the unconditional stale nudge above: the data_delayed
  // alert is opt-in (per-connection alert_rules row), uses a more
  // conservative threshold (DATA_DELAYED_AFTER_HOURS -- past two
  // consecutive missed auto-sync windows, not just one), and dedupes
  // through alert_events rather than stale_notified_at. Reuses this same
  // daily tick rather than a second scheduler -- this cron already lists
  // every connected, non-demo connection's lastSyncedAt, which is exactly
  // what that evaluation needs.
  const alertResult = await evaluateDataDelayedAlerts(
    connections.map((connection) => ({
      connectionId: connection.id,
      userId: connection.userId,
      lastSyncedAt: connection.lastSyncedAt
    }))
  );

  return NextResponse.json({
    ok: true,
    checked: connections.length,
    notified,
    skipped,
    dataDelayedAlerts: alertResult
  });
}
