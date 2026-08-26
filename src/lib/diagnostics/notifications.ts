import "server-only";

import { sendPushToUserWithReport, type PushPayload } from "../push-notify";
import { listAdminUserIds } from "../user-roles";

export function operationalNotificationUrl(context: { connectionId?: string; eventId?: string } = {}): string {
  const params = new URLSearchParams();
  if (context.connectionId) params.set("connection", context.connectionId);
  if (context.eventId) params.set("event", context.eventId);
  const query = params.toString();
  return `/admin/diagnostics${query ? `?${query}` : ""}`;
}

export async function sendOperationalPushToAdmins(
  payload: Omit<PushPayload, "url"> & { connectionId?: string; eventId?: string }
): Promise<{ admins: number; attempted: number; delivered: number; failed: number }> {
  const adminUserIds = await listAdminUserIds();
  const { connectionId, eventId, ...copy } = payload;
  const results = await Promise.allSettled(
    adminUserIds.map((userId) =>
      sendPushToUserWithReport(userId, {
        ...copy,
        url: operationalNotificationUrl({ connectionId, eventId })
      })
    )
  );

  const reports = results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
  const rejected = results.length - reports.length;

  return reports.reduce(
    (total, report) => ({
      admins: total.admins,
      attempted: total.attempted + report.attempted,
      delivered: total.delivered + report.delivered,
      failed: total.failed + report.hardFailures
    }),
    { admins: adminUserIds.length, attempted: 0, delivered: 0, failed: rejected }
  );
}
