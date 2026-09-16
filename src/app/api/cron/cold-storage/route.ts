import { NextResponse } from "next/server";
import { getCronSecret } from "@/lib/env";
import {
  claimColdStorageCandidates,
  completeConnectionHibernation,
  markConnectionHibernationError,
  purgeColdStorageBatch
} from "@/lib/newinmeter/connection";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const CLAIM_LIMIT = 2;
const DELETE_BATCH_SIZE = 2000;
const WORK_BUDGET_MS = 45_000;

export async function GET(request: Request) {
  if (request.headers.get("authorization") !== `Bearer ${getCronSecret()}`) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }

  const deadline = Date.now() + WORK_BUDGET_MS;
  const claimed = await claimColdStorageCandidates(CLAIM_LIMIT);
  const results: Array<Record<string, unknown>> = [];

  for (const connection of claimed) {
    const deleted = { energyRows: 0, hourlyRollups: 0, intervalRollups: 0 };
    try {
      let remaining = true;
      while (remaining && Date.now() < deadline) {
        const batch = await purgeColdStorageBatch(connection.connectionId, DELETE_BATCH_SIZE);
        deleted.energyRows += batch.energyRowsDeleted;
        deleted.hourlyRollups += batch.hourlyRollupsDeleted;
        deleted.intervalRollups += batch.intervalRollupsDeleted;
        remaining = batch.remaining;
      }

      if (!remaining) {
        await completeConnectionHibernation(connection.connectionId);
      }
      results.push({ connectionId: connection.connectionId, state: remaining ? "hibernating" : "cold", deleted });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Cold-storage purge failed.";
      await markConnectionHibernationError(connection.connectionId, message).catch(() => {});
      results.push({ connectionId: connection.connectionId, state: "hibernating", error: message, deleted });
    }

    if (Date.now() >= deadline) break;
  }

  console.info("newinmeter_cold_storage_run", { claimed: claimed.length, results });
  return NextResponse.json({ ok: true, claimed: claimed.length, results });
}

// Also accepts POST for local/operator invocation with the same bearer guard.
export const POST = GET;
