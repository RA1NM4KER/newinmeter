import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { loadLiveOverview } from "@/lib/live/meter";
import type { LiveOverview } from "@/lib/live/meter-types";

/**
 * Beacon-facing surface.
 *
 * A deliberately small, private summary of NewinMeter's live state for Beacon
 * (Kefas's personal context layer). Beacon consumes THIS shape — it never reads
 * NewinMeter's tables. Auth is a single service token; the reported user is
 * fixed by env so the endpoint carries no identity in the request.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  // timingSafeEqual requires equal-length buffers; the length check itself is
  // not the secret, and a non-matching length can never be the right token.
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function authorized(request: Request): boolean {
  const expected = process.env.NEWINMETER_BEACON_TOKEN;
  if (!expected) return false;
  const header = request.headers.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!provided) return false;
  return safeEqual(provided, expected);
}

type AppSummary = {
  app: "newinmeter";
  headline: string;
  status: "ok" | "attention" | "down" | "unknown";
  metrics: Array<{ label: string; value: string | number; hint?: string }>;
  attention?: string[];
  generatedAt: string;
};

function round(value: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round(value * f) / f;
}

function toSummary(o: LiveOverview): AppSummary {
  const generatedAt = o.generatedAt;

  if (!o.device) {
    return {
      app: "newinmeter",
      headline: "No meter configured",
      status: "unknown",
      metrics: [],
      generatedAt
    };
  }

  const watts = o.latest.estimatedWatts;
  const wattsLabel = watts === null ? "—" : `${Math.round(watts)} W`;

  const status: AppSummary["status"] =
    o.latest.estimateState === "fresh" ? "ok" : o.latest.estimateState === "stale" ? "attention" : "unknown";

  const headline =
    o.latest.estimateState === "fresh"
      ? `Live load ${wattsLabel}`
      : o.latest.estimateState === "stale"
        ? `Last load ${wattsLabel} · no recent pulse`
        : `${o.device.name} online · awaiting pulses`;

  const metrics: AppSummary["metrics"] = [
    { label: "Live load", value: wattsLabel },
    { label: "Last hour", value: `${round(o.energy.lastHourKwh)} kWh` },
    { label: "Last 5 min", value: `${round(o.energy.last5MinutesKwh, 3)} kWh` },
    { label: "Meter", value: o.device.name }
  ];

  const attention = o.latest.estimateState === "stale" ? [`No recent pulse from ${o.device.name}.`] : undefined;

  return { app: "newinmeter", headline, status, metrics, attention, generatedAt };
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const userId = process.env.NEWINMETER_BEACON_USER_ID;
  if (!userId) {
    return NextResponse.json({ error: "NEWINMETER_BEACON_USER_ID not configured" }, { status: 503 });
  }
  try {
    const overview = await loadLiveOverview(userId, "1h");
    return NextResponse.json(toSummary(overview), {
      headers: { "Cache-Control": "no-store" }
    });
  } catch {
    return NextResponse.json({ error: "summary failed" }, { status: 500 });
  }
}
