import { adminSupabaseCount, adminSupabaseFetch, adminSupabaseRequest } from "../src/lib/supabase-rest";
import { resolveTariffBand } from "../src/lib/newinmeter/tariff-profiles";

const BATCH_SIZE = 500;

type ConnectionRow = { id: string; tariff_profile: string | null };
type LedgerRow = {
  id: number;
  connection_id: string;
  charge_label: string;
  period_dt: string;
  tariff: number | string;
  charge_kind: "energy" | "water";
};

async function main() {
  const before = {
    energy: await adminSupabaseCount("/energy_rows?select=id&charge_kind=eq.energy&tariff_band=is.null&limit=1"),
    water: await adminSupabaseCount("/energy_rows?select=id&charge_kind=eq.water&tariff_band=is.null&limit=1")
  };
  const connections = await adminSupabaseFetch<ConnectionRow[]>("/livemopay_connections?select=id,tariff_profile");
  const profileByConnection = new Map(connections.map((row) => [row.id, row.tariff_profile]));
  let lastId = 0;
  let scanned = 0;
  const updated = { energy: 0, water: 0 };

  while (true) {
    const rows = await adminSupabaseFetch<LedgerRow[]>(
      `/energy_rows?select=id,connection_id,charge_label,period_dt,tariff,charge_kind` +
        `&charge_kind=in.(energy,water)&tariff_band=is.null&id=gt.${lastId}&order=id.asc&limit=${BATCH_SIZE}`
    );
    if (!rows.length) break;

    scanned += rows.length;
    lastId = rows[rows.length - 1].id;
    const idsByBand = new Map<string, number[]>();
    for (const row of rows) {
      const band = resolveTariffBand({
        kind: row.charge_kind,
        chargeLabel: row.charge_label,
        tariffProfile: profileByConnection.get(row.connection_id) ?? null,
        periodDate: row.period_dt,
        tariff: row.tariff
      });
      if (!band) continue;
      const ids = idsByBand.get(band) ?? [];
      ids.push(row.id);
      idsByBand.set(band, ids);
      updated[row.charge_kind] += 1;
    }

    for (const [band, ids] of Array.from(idsByBand.entries())) {
      await adminSupabaseRequest(
        "PATCH",
        `/energy_rows?id=in.(${ids.join(",")})&charge_kind=in.(energy,water)&tariff_band=is.null`,
        { tariff_band: band },
        "return=minimal"
      );
    }
  }

  const unresolved = {
    energy: await adminSupabaseCount("/energy_rows?select=id&charge_kind=eq.energy&tariff_band=is.null&limit=1"),
    water: await adminSupabaseCount("/energy_rows?select=id&charge_kind=eq.water&tariff_band=is.null&limit=1")
  };
  console.log(JSON.stringify({ before, scanned, updated, unresolved }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
