import { loadExportRows } from "@/lib/energy-data";
import { toCSVString, toXLSXBuffer } from "@/lib/export";
import type { EnergyRowsPageQuery } from "@/lib/energy-data";
import { requireConnectedSession } from "@/lib/auth/session";
import { enforceRateLimit, getRateLimitIdentifier, rateLimitHeaders } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requireConnectedSession();
  if (!auth.ok) {
    return new Response(
      JSON.stringify({
        message: auth.status === 401 ? "Authentication required." : "Connect a LiveMopay account first."
      }),
      { status: auth.status, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    const identifier = getRateLimitIdentifier(auth.session.userId, "export");
    const rateLimit = await enforceRateLimit(identifier, "export");
    const rateHeaders = rateLimitHeaders(rateLimit);

    if (!rateLimit.allowed) {
      return new Response(JSON.stringify({ message: "Rate limit exceeded. Please try again later." }), {
        status: 429,
        headers: { "Content-Type": "application/json", ...rateHeaders }
      });
    }

    const { searchParams } = new URL(request.url);
    const format = searchParams.get("format") ?? "csv";

    const query: Omit<EnergyRowsPageQuery, "page" | "pageSize"> = {
      from: searchParams.get("from") ?? undefined,
      to: searchParams.get("to") ?? undefined,
      chargeType: (searchParams.get("chargeType") as EnergyRowsPageQuery["chargeType"]) ?? undefined,
      search: searchParams.get("search") ?? undefined,
      sortKey: (searchParams.get("sort") as EnergyRowsPageQuery["sortKey"]) ?? undefined,
      sortDirection: (searchParams.get("dir") as EnergyRowsPageQuery["sortDirection"]) ?? undefined
    };

    const rows = await loadExportRows(auth.session.accessToken, query);
    const from = query.from ?? "all";
    const to = query.to ?? "time";
    const filename = `electricity-ledger-${from}-${to}`;

    if (format === "xlsx") {
      const buffer = toXLSXBuffer(rows);
      return new Response(buffer as unknown as BodyInit, {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="${filename}.xlsx"`,
          ...rateHeaders
        }
      });
    }

    const csv = toCSVString(rows);
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv;charset=utf-8;",
        "Content-Disposition": `attachment; filename="${filename}.csv"`,
        ...rateHeaders
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Export failed.";
    return new Response(JSON.stringify({ message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}
