import { getRecentNotifications } from "@/lib/newinmeter/alerts";
import type { AssistantTool } from "../types";
import { GetRecentAlertsSchema } from "./schemas";

export const getRecentAlertsTool: AssistantTool = {
  definition: {
    type: "function",
    name: "get_recent_alerts",
    description:
      "List the most recent alert events for this account (type, when triggered, title/body, whether read). Reuses the exact same list the notification centre shows -- suppressed events (the losing half of a correlated pair, e.g. low_balance suppressed by balance_runway) are never included. Use for 'what alerts have fired', 'why did my latest alert fire' (pair with explain_alert), or to find an alertEventId to explain.",
    parameters: GetRecentAlertsSchema,
    strict: true
  },
  handler: async (args, getContext) => {
    const context = await getContext();
    const requestedLimit = typeof args.limit === "number" ? args.limit : Number(args.limit ?? 10);
    const limit = Math.min(30, Math.max(1, Number.isFinite(requestedLimit) ? requestedLimit : 10));

    const notifications = await getRecentNotifications(context.userId, limit);

    return {
      scope: context.scope,
      alerts: notifications.map((item) => ({
        alertEventId: item.id,
        type: item.type,
        title: item.title,
        body: item.body,
        triggeredAt: item.triggeredAt,
        isRead: item.isRead
      }))
    };
  }
};
