"use client";

// Single client-side owner of "can this device receive Web Push, and does it
// have a live subscription" -- General's BadgePermissionCard and Settings'
// AlertRuleRow both need this exact capability (subscribe/unsubscribe,
// permission state, requesting permission) and previously duplicated it.
// Server-side push SENDING lives in ../push-notify.ts (a completely
// different, server-only concern) -- this file never touches that.

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

// Renamed from the earlier "push-prompt-dismissed" flag when its meaning
// changed: it no longer means "dismissed the browser-permission education",
// it means "chose Keep notifications off for this device" -- a real product
// preference, not a permission-prompt annoyance. Deliberately not reusing
// the old key/semantics; see push-notification-provider.tsx for how this
// gets cleared the moment the device's push actually turns on again.
const DEVICE_NOTIFICATIONS_DISMISSED_STORAGE_KEY = "newinmeter:device-notifications-dismissed";

export type PushPermissionState = "unsupported" | "default" | "granted" | "denied";

// Three categories, each meaning something different for the user:
// - browser_registration_failed: PushManager.subscribe() itself threw.
//   This is the one Brave's disabled push transport lands in, and the only
//   one specific enough to justify Brave-specific copy -- see
//   describeSubscriptionFailure.
// - client_setup_failed: something NewinMeter needed before even trying to
//   subscribe wasn't there (no VAPID key configured, service worker never
//   became ready). Also browser-side/pre-network, but not "the push
//   service refused this device" -- lumping it in with
//   browser_registration_failed would make Brave-specific copy fire for
//   e.g. a plain misconfigured deployment, which has nothing to do with
//   Brave.
// - server_registration_failed: the browser handed us a real subscription,
//   NewinMeter's own /api/push/subscribe round trip failed. This one is
//   NewinMeter's problem, not the browser's.
export type SubscriptionFailureReason =
  | "browser_registration_failed"
  | "client_setup_failed"
  | "server_registration_failed";

export type PushEnableResult =
  | { status: "granted" }
  | { status: "denied" }
  | { status: "unsupported" }
  | { status: "subscription_failed"; reason: SubscriptionFailureReason };

// `navigator.brave` only exists in Brave -- used purely to decide whether a
// browser-side registration failure is worth Brave-specific copy, never to
// change subscribe behaviour itself. Brave's own "Use Google services for
// push messaging" setting (off by default) makes PushManager.subscribe()
// throw before any network request, which is otherwise indistinguishable
// from a dozen other legitimate reasons a browser might refuse to register.
export function isBraveBrowser(): boolean {
  return typeof navigator !== "undefined" && "brave" in navigator;
}

// Dev-only, best-effort diagnostics for exactly this kind of "which phase
// of subscribing failed" question -- never the subscription object itself
// (that's where the auth/p256dh keys and the real endpoint live), only the
// coarse state needed to tell platforms apart. No-op in production.
function logPushDiagnostic(phase: string, error?: unknown): void {
  if (process.env.NODE_ENV === "production") {
    return;
  }
  console.info("[push]", phase, {
    permission: typeof Notification !== "undefined" ? Notification.permission : "unavailable",
    isBrave: isBraveBrowser(),
    error: error instanceof Error ? { name: error.name, message: error.message } : undefined
  });
}

// User-facing copy for a subscription_failed result -- kept here rather
// than in each component so General/Alerts/anywhere else that surfaces
// this in the future all say the same thing. Never shows the raw browser
// exception text.
export function describeSubscriptionFailure(reason: SubscriptionFailureReason): string {
  if (reason === "browser_registration_failed" && isBraveBrowser()) {
    return 'Brave couldn’t connect to its push service. In Brave settings, turn on "Use Google services for push messaging," then try again.';
  }
  if (reason === "server_registration_failed") {
    return "Couldn't turn on notifications. Try again.";
  }
  return "Your browser couldn't register this device for push notifications. Check your browser's notification/push settings and try again.";
}

function isPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof Notification !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window
  );
}

// Read-only -- never triggers the browser's permission prompt. Safe to call
// on every render/mount (General's status row, Alerts tab's device-status
// line).
export function getPushPermissionState(): PushPermissionState {
  if (!isPushSupported()) {
    return "unsupported";
  }
  return Notification.permission as PushPermissionState;
}

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const output = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) {
    output[i] = raw.charCodeAt(i);
  }
  return output;
}

// serviceWorker.ready never resolves when no worker will ever activate (e.g.
// localhost, where the PWA registrar unregisters the SW), which would leave
// a caller stuck awaiting forever. Race it against a timeout so this always
// settles.
async function getReadyRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) {
    return null;
  }
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000))
  ]);
}

export async function hasActiveSubscription(): Promise<boolean> {
  if (!("serviceWorker" in navigator)) {
    return false;
  }
  const registration = await getReadyRegistration();
  if (!registration) {
    return false;
  }
  return Boolean(await registration.pushManager.getSubscription());
}

type SubscribeOutcome = { ok: true } | { ok: false; reason: SubscriptionFailureReason };

// Assumes permission is already "granted" -- creates (or reuses) a
// subscription and registers it with the server. Never throws -- every
// caller treats a failed subscribe as a recoverable, non-fatal state.
// Three phases, each tagged with its own SubscriptionFailureReason (see
// that type's own comment): missing prerequisites / SW not ready
// (client_setup_failed), PushManager.subscribe() itself throwing
// (browser_registration_failed -- the one Brave's disabled push transport
// lands in), and NewinMeter's own API call failing (server_registration_failed).
async function subscribeToPush(): Promise<SubscribeOutcome> {
  if (!VAPID_PUBLIC_KEY || !("serviceWorker" in navigator) || !("PushManager" in window)) {
    logPushDiagnostic("client_setup_failed:missing_prerequisite");
    return { ok: false, reason: "client_setup_failed" };
  }

  const registration = await getReadyRegistration();
  if (!registration) {
    logPushDiagnostic("client_setup_failed:service_worker_not_ready");
    return { ok: false, reason: "client_setup_failed" };
  }

  let subscription: PushSubscription;
  try {
    const existing = await registration.pushManager.getSubscription();
    subscription =
      existing ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
      }));
  } catch (error) {
    // This is where Brave's "Registration failed - push service error"
    // AbortError lands -- entirely browser-side, before any NewinMeter
    // request is ever made.
    logPushDiagnostic("browser_registration_failed:subscribe_threw", error);
    return { ok: false, reason: "browser_registration_failed" };
  }

  try {
    const response = await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(subscription.toJSON())
    });
    if (!response.ok) {
      logPushDiagnostic("server_registration_failed:response_not_ok");
      return { ok: false, reason: "server_registration_failed" };
    }
    return { ok: true };
  } catch (error) {
    logPushDiagnostic("server_registration_failed:fetch_threw", error);
    return { ok: false, reason: "server_registration_failed" };
  }
}

// Re-registers an ALREADY-EXISTING browser subscription with the server --
// never creates one. Distinct from subscribeToPush (which will create a new
// subscription if none exists): this is purely a repair for "browser still
// has a live subscription but the server's push_subscriptions row might be
// stale or missing" (e.g. wiped server-side, VAPID rotated), called
// opportunistically whenever the provider confirms the device is already
// on. If no subscription exists, this is a no-op -- it must never be the
// thing that flips a device from off to on, or "General OFF" would keep
// getting silently overridden the same way the original bug did.
export async function repairExistingSubscription(): Promise<boolean> {
  if (!("serviceWorker" in navigator)) {
    return false;
  }
  try {
    const registration = await getReadyRegistration();
    if (!registration) {
      return false;
    }
    const existing = await registration.pushManager.getSubscription();
    if (!existing) {
      return false;
    }
    const response = await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(existing.toJSON())
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function unsubscribeFromPush(): Promise<void> {
  if (!("serviceWorker" in navigator)) {
    return;
  }
  const registration = await getReadyRegistration();
  if (!registration) {
    return;
  }
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    return;
  }

  const { endpoint } = subscription;
  await subscription.unsubscribe().catch(() => undefined);
  await fetch("/api/push/unsubscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint })
  }).catch(() => undefined);
}

// The one function that may prompt the browser's native permission UI --
// only via Notification.requestPermission(), and only when permission is
// still "default" (already granted/denied is a no-op read). Callers must
// only invoke this at a moment that's an acceptable trigger for that native
// prompt (directly from a user's own button click) -- this module never
// decides *when* to ask, only *how*.
export async function ensurePushNotificationsEnabled(): Promise<PushEnableResult> {
  if (!isPushSupported()) {
    return { status: "unsupported" };
  }

  let permission = Notification.permission;
  if (permission === "default") {
    permission = await Notification.requestPermission();
  }

  if (permission !== "granted") {
    return { status: "denied" };
  }

  const outcome = await subscribeToPush();
  return outcome.ok ? { status: "granted" } : { status: "subscription_failed", reason: outcome.reason };
}

// Device-level "the user chose to keep device notifications off" flag --
// localStorage (not sessionStorage), so the choice survives reloads/
// relaunches on this device. Not persisted server-side: this is purely
// "should Alerts' enable flow bother asking again on this device", not
// account state. Set only by AlertRuleRow's "Keep notifications off";
// cleared automatically by PushNotificationProvider the moment this
// device's push actually turns on (via either General or Alerts) -- so
// turning it off again later via General is treated as a fresh decision,
// not something still being suppressed by a stale dismissal from before.
// General itself never reads this flag: it is always the explicit,
// always-available management surface regardless of what Alerts' dialog
// history looks like.
export function hasDismissedDeviceNotifications(): boolean {
  try {
    return window.localStorage.getItem(DEVICE_NOTIFICATIONS_DISMISSED_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function markDeviceNotificationsDismissed(): void {
  try {
    window.localStorage.setItem(DEVICE_NOTIFICATIONS_DISMISSED_STORAGE_KEY, "1");
  } catch {
    // Best-effort -- private browsing / storage disabled shouldn't block
    // the alert itself from saving.
  }
}

export function clearDeviceNotificationsDismissed(): void {
  try {
    window.localStorage.removeItem(DEVICE_NOTIFICATIONS_DISMISSED_STORAGE_KEY);
  } catch {
    // Best-effort.
  }
}
