import "server-only";

import webpush from "web-push";
import { getVapidPrivateKey, getVapidPublicKey, getVapidSubject } from "./env";
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
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<number> {
  ensureVapidConfigured();

  const subscriptions = await getSubscriptionsForUser(userId);
  if (subscriptions.length === 0) {
    return 0;
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
        return true;
      } catch (error) {
        const statusCode = (error as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          await deleteSubscriptionByEndpoint(subscription.endpoint);
        } else {
          console.error(`Push send failed for endpoint (${statusCode ?? "unknown"})`, error);
        }
        return false;
      }
    })
  );

  return results.filter(Boolean).length;
}
