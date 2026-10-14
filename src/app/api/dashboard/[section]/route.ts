import { NextResponse } from "next/server";
import { requireConnectedSession } from "@/lib/auth/session";
import { limitUserRequest } from "@/lib/rate-limit";
import { loadDashboardDailyRollups, loadDashboardHourlyRollups, loadDashboardSummary } from "@/lib/dashboard-data";
import { DASHBOARD_SECTIONS, type DashboardSection } from "@/lib/dashboard-sections";
import { getUserFeatureAccessDetailed } from "@/lib/features";
import { getAlertRulesForUser } from "@/lib/newinmeter/alerts";
import { getFeatureAdoption, getFeatureAdoptionRates } from "@/lib/newinmeter/feature-adoption";
import { promptDayKey } from "@/lib/dashboard-prompts";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: { section: string } }) {
  const auth = await requireConnectedSession();
  if (!auth.ok) return NextResponse.json({ message: "A connected account is required." }, { status: auth.status });
  if (!DASHBOARD_SECTIONS.includes(params.section as DashboardSection))
    return NextResponse.json({ message: "Unknown dashboard section." }, { status: 400 });
  const rate = await limitUserRequest(auth.session.userId, `dashboard-${params.section}`);
  if (rate.response) return rate.response;
  try {
    const { accessToken, userId, connection } = auth.session;
    let data;
    switch (params.section as DashboardSection) {
      case "summary":
        data = await loadDashboardSummary(accessToken);
        break;
      case "daily":
        data = await loadDashboardDailyRollups(accessToken);
        break;
      case "hourly":
        data = await loadDashboardHourlyRollups(accessToken);
        break;
      case "prompts": {
        const features = await getUserFeatureAccessDetailed(userId);
        const [alertRules, featureAdoption, featureRates] = await Promise.all([
          features.alerts.enabled
            ? getAlertRulesForUser(userId).catch((error) => {
                console.error(
                  "newinmeter_dashboard_alert_rules_failed",
                  error instanceof Error ? error.message : error
                );
                return [];
              })
            : [],
          features.ai.enabled || features.activities.enabled ? getFeatureAdoption(userId, connection.id) : null,
          getFeatureAdoptionRates().catch((error) => {
            console.error("newinmeter_dashboard_adoption_rates_failed", error instanceof Error ? error.message : error);
            return {};
          })
        ]);
        data = { alertRules, featureAdoption, featureRates, promptDay: promptDayKey() };
        break;
      }
    }
    return NextResponse.json(data, { headers: { ...rate.headers, "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("dashboard_section_failed", params.section, error instanceof Error ? error.message : error);
    return NextResponse.json({ message: "Unable to load this dashboard section." }, { status: 500 });
  }
}
