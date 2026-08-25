import { createAnalytics } from "@/lib/analytics";
import { loadDashboardDailyRollups, loadDashboardHourlyRollups, loadDashboardSummary } from "@/lib/dashboard-data";
import type { DashboardSummary } from "@/lib/types";
import type { AssistantPermissions, AssistantScope, AssistantToolHandler, DashboardContext } from "../types";
import { compareCalendarMonthsTool } from "./compare-calendar-months";
import { comparePreviousPeriodTool } from "./compare-previous-period";
import { explainAlertTool } from "./explain-alert";
import { explainDayTool } from "./explain-day";
import { findActivitiesTool } from "./find-activities";
import { getActivityReportTool } from "./get-activity-report";
import { getAlertRecommendationsTool } from "./get-alert-recommendations";
import { getAlertStatusTool } from "./get-alert-status";
import { getBalanceRunoutTool } from "./get-balance-runout";
import { getDataStatusTool } from "./get-data-status";
import { getRecentAlertsTool } from "./get-recent-alerts";
import { getRecentTopupsTool } from "./get-recent-topups";
import { getScopeOverviewTool } from "./get-scope-overview";
import { getWaterOverviewTool } from "./get-water-overview";
import { getTopDaysTool } from "./get-top-days";
import { getTopHoursTool } from "./get-top-hours";
import { inspectTimeWindowTool } from "./inspect-time-window";

function pickScope(summary: DashboardSummary, scope: AssistantScope) {
  return {
    from: scope.from || summary.dateStart || "",
    to: scope.to || summary.dateEnd || ""
  };
}

export function createAssistantToolbox(
  accessToken: string,
  userId: string,
  scope: AssistantScope,
  permissions: AssistantPermissions
) {
  let contextPromise: Promise<DashboardContext> | null = null;

  async function getContext() {
    if (!contextPromise) {
      contextPromise = (async () => {
        const [summary, dailyRows, hourlyRows] = await Promise.all([
          loadDashboardSummary(accessToken),
          loadDashboardDailyRollups(accessToken),
          loadDashboardHourlyRollups(accessToken)
        ]);
        const resolvedScope = pickScope(summary, scope);
        const analytics = createAnalytics(dailyRows, hourlyRows, resolvedScope.from, resolvedScope.to);

        return {
          accessToken,
          userId,
          permissions,
          summary,
          dailyRows,
          hourlyRows,
          analytics,
          scope: resolvedScope
        };
      })();
    }

    return contextPromise;
  }

  const toolSet = [
    getScopeOverviewTool,
    getBalanceRunoutTool,
    comparePreviousPeriodTool,
    compareCalendarMonthsTool,
    getTopDaysTool,
    getTopHoursTool,
    explainDayTool,
    inspectTimeWindowTool,
    getRecentTopupsTool,
    getWaterOverviewTool,
    getDataStatusTool,
    // Registered only when the account has Activities enabled -- the model
    // must never see this tool exists otherwise, not merely be refused when
    // it tries to call it.
    ...(permissions.activitiesEnabled ? [getActivityReportTool, findActivitiesTool] : []),
    // Same posture for Alerts: no alert tool exists in the model's tool
    // list at all when the Alerts feature is off for this account.
    ...(permissions.alertsEnabled
      ? [getAlertStatusTool, getRecentAlertsTool, explainAlertTool, getAlertRecommendationsTool]
      : [])
  ];

  const toolHandlers = Object.fromEntries(toolSet.map((tool) => [tool.definition.name, tool.handler])) as Record<
    string,
    AssistantToolHandler
  >;

  const tools = toolSet.map((tool) => tool.definition);

  return {
    tools,
    async execute(name: string, args: Record<string, unknown>) {
      const handler = toolHandlers[name];

      if (!handler) {
        throw new Error(`Unknown assistant tool: ${name}`);
      }

      return handler(args, getContext);
    }
  };
}
