import { activityReportToCsv, activityReportToXlsx } from "@/lib/activity/export";
import { loadActivityReport } from "@/lib/activity/data";
import { parseActivityQuery } from "@/lib/activity/query-params";
import { isIsoDate } from "@/lib/activity/utils";
import { requireActivitiesSession } from "@/lib/auth/session";
import { enforceRateLimit, getRateLimitIdentifier, rateLimitHeaders } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requireActivitiesSession();
  if (!auth.ok)
    return Response.json(
      {
        message:
          auth.status === 401
            ? "Authentication required."
            : auth.status === 403
              ? "Activities is not enabled for your account."
              : "Connect a LiveMopay account first."
      },
      { status: auth.status }
    );
  const limit = await enforceRateLimit(getRateLimitIdentifier(auth.session.userId, "activity-export"));
  const headers = rateLimitHeaders(limit);
  if (!limit.allowed)
    return Response.json({ message: "Rate limit exceeded. Please try again later." }, { status: 429, headers });
  const searchParams = new URL(request.url).searchParams;
  const filters = parseActivityQuery(searchParams);
  const format = searchParams.get("format") === "xlsx" ? "xlsx" : "csv";
  if (!filters.from || !filters.to || !isIsoDate(filters.from) || !isIsoDate(filters.to) || filters.from > filters.to) {
    return Response.json({ message: "Choose a valid activity export date range." }, { status: 400, headers });
  }
  try {
    const report = await loadActivityReport(auth.session.accessToken, {
      from: filters.from,
      to: filters.to,
      tags: filters.tags,
      utility: filters.utility
    });
    const filename = `activity-report-${filters.from}-${filters.to}`;
    if (format === "xlsx") {
      return new Response(activityReportToXlsx(report.rows) as unknown as BodyInit, {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="${filename}.xlsx"`,
          ...headers
        }
      });
    }

    return new Response(activityReportToCsv(report.rows), {
      headers: {
        "Content-Type": "text/csv;charset=utf-8;",
        "Content-Disposition": `attachment; filename="${filename}.csv"`,
        ...headers
      }
    });
  } catch (error) {
    return Response.json(
      { message: error instanceof Error ? error.message : "Activity export failed." },
      { status: 500 }
    );
  }
}
