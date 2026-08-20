"use client";

import { buildDailyRollupsUrl } from "./endpoints";
import type { DailyRollupRow } from "./types";

export async function fetchDailyRollups(range: { from?: string; to?: string } = {}) {
  const response = await fetch(buildDailyRollupsUrl(range), { cache: "no-store" });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || "Failed to load daily rollups.");
  }

  return (await response.json()) as { rows: DailyRollupRow[] };
}
