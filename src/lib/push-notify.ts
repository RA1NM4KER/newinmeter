import "server-only";

import webpush from "web-push";
import { getVapidPrivateKey, getVapidPublicKey, getVapidSubject } from "./env";
import { openSystemIncident, recordSystemHealthCheck, resolveSystemIncident } from "./diagnostics/store";
import { deleteSubscriptionByEndpoint, getSubscriptionsForUser } from "./push-subscriptions";

export type PushPayload = {
  title: string;
  body: string;
  url?: string;
  // Per-type notification tag (see sw.js) so two different simultaneous
  // alerts don't collapse into one OS notification. Optional: falls back to
  // the service worker's own default tag when omitted.
  tag?: string;
};

export type PushDeliveryReport = {
  attempted: number;
  delivered: number;
  expiredRemoved: number;
  hardFailures: number;
};

let vapidConfigured = false;

// web-push keeps VAPID details in module state; set them once per process on
// first send rather than at import time, so a missing key only fails a send
// attempt (not every route that transitively imports this module).
function ensureVapidConfigured() {
  if (vapidConfigured) {
    return;
  }
  webpush.setVapidDetails(getVapidSubject(), getVapidPublicKey(), getVapidPrivateKey());
  vapidConfigured = true;
}

// Fans a payload out to every device the user has subscribed. Dead endpoints
// (404 gone / 410 expired) are pruned so they don't accumulate. Returns how
// many devices were successfully reached.
async function recordPushDeliveryHealth(report: PushDeliveryReport): Promise<void> {
  if (report.attempted === 0) return;

  try {
    if (report.hardFailures > 0) {
      await recordSystemHealthCheck({
        component: "push:delivery",
        status: "warning",
        succeeded: false,
        details: report
      });
      await openSystemIncident({
        severity: "warning",
        category: "push",
        eventType: "push_delivery_failed",
        message: "One or more push deliveries failed without an expired-endpoint response.",
        metadata: report,
        incidentKey: "push:delivery_failure"
      });
      return;
    }

    if (report.delivered > 0) {
      await recordSystemHealthCheck({
        component: "push:delivery",
        status: "healthy",
        succeeded: true,
        details: report
      });
      await resolveSystemIncident("push:delivery_failure", {
        category: "push",
        eventType: "push_delivery_recovered",
        message: "Push delivery recovered."
      });
    }
  } catch {
    // Diagnostics must never turn a successfully delivered household alert
    // into an application failure (including during migration rollout).
    console.error("newinmeter_push_health_record_failed");
  }
}

export async function sendPushToUserWithReport(userId: string, payload: PushPayload): Promise<PushDeliveryReport> {
  ensureVapidConfigured();

  const subscriptions = await getSubscriptionsForUser(userId);
  if (subscriptions.length === 0) {
    return { attempted: 0, delivered: 0, expiredRemoved: 0, hardFailures: 0 };
  }

  const body = JSON.stringify(payload);

  const results = await Promise.all(
    subscriptions.map(async (subscription) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth }
          },
          body
        );
        return "delivered" as const;
      } catch (error) {
        const statusCode = (error as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          await deleteSubscriptionByEndpoint(subscription.endpoint);
          return "expired" as const;
        } else {
          console.error(`Push send failed for endpoint (${statusCode ?? "unknown"})`, error);
          return "failed" as const;
        }
      }
    })
  );

  const report = {
    attempted: subscriptions.length,
    delivered: results.filter((result) => result === "delivered").length,
    expiredRemoved: results.filter((result) => result === "expired").length,
    hardFailures: results.filter((result) => result === "failed").length
  };
  await recordPushDeliveryHealth(report);
  return report;
}

// Backward-compatible count-only API used by household alerts and stale-data
// notifications. The richer report is available to Admin Diagnostics.
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<number> {
  const report = await sendPushToUserWithReport(userId, payload);
  return report.delivered;
}
