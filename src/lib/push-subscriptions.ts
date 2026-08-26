import "server-only";

import {
  adminSupabaseCount,
  adminSupabaseRawResponse,
  adminSupabaseFetch,
  adminSupabaseRequest
} from "./supabase-rest";

// The three fields a browser PushSubscription serializes to, plus the user we
// resolved it for. Stored verbatim so web-push can address the endpoint later.
export type PushSubscriptionRecord = {
  endpoint: string;
  p256dh: string;
  auth: string;
};

type PushSubscriptionRow = PushSubscriptionRecord & {
  id: string;
  user_id: string;
};

const SUBSCRIPTION_SELECT = "id,user_id,endpoint,p256dh,auth";

// Upsert on the unique endpoint: a device that re-subscribes (permission
// toggled, or the push service rotated its endpoint keys) overwrites its own
// row and re-points it at the current user, rather than piling up duplicates.
export async function savePushSubscription(userId: string, record: PushSubscriptionRecord): Promise<void> {
  await adminSupabaseRequest(
    "POST",
    "/push_subscriptions?on_conflict=endpoint",
    {
      user_id: userId,
      endpoint: record.endpoint,
      p256dh: record.p256dh,
      auth: record.auth,
      last_seen_at: new Date().toISOString()
    },
    "resolution=merge-duplicates,return=minimal"
  );
}

// Ownership-scoped delete: the endpoint alone is unique, but we still filter by
// user_id so a caller can only ever remove their own subscription.
export async function deletePushSubscription(userId: string, endpoint: string): Promise<void> {
  await adminSupabaseRequest(
    "DELETE",
    `/push_subscriptions?user_id=eq.${encodeURIComponent(userId)}&endpoint=eq.${encodeURIComponent(endpoint)}`,
    undefined,
    "return=minimal"
  );
}

export async function getSubscriptionsForUser(userId: string): Promise<PushSubscriptionRow[]> {
  return adminSupabaseFetch<PushSubscriptionRow[]>(
    `/push_subscriptions?select=${SUBSCRIPTION_SELECT}&user_id=eq.${encodeURIComponent(userId)}`
  );
}

export async function countPushSubscriptions(): Promise<number> {
  return adminSupabaseCount("/push_subscriptions?select=id");
}

// Called by the notifier when the push service reports an endpoint is gone
// (404/410) -- prunes the dead row so we stop trying to reach an uninstalled
// or expired subscription.
export async function deleteSubscriptionByEndpoint(endpoint: string): Promise<void> {
  const response = await adminSupabaseRawResponse(
    "DELETE",
    `/push_subscriptions?endpoint=eq.${encodeURIComponent(endpoint)}`,
    undefined,
    "return=minimal"
  );

  if (!response.ok) {
    // Best-effort cleanup: a failed prune shouldn't break the notify loop.
    console.error(`Failed to prune push subscription (${response.status})`);
  }
}
