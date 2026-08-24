"use client";

// Single client-side owner of "can this device receive Web Push, and does it
// have a live subscription" -- General's BadgePermissionCard and Settings'
// AlertRuleRow both need this exact capability (subscribe/unsubscribe,
// permission state, requesting permission) and previously duplicated it.
// Server-side push SENDING lives in ../push-notify.ts (a completely
// different, server-only concern) -- this file never touches that.

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

const DISMISSED_PROMPT_STORAGE_KEY = "newinmeter:push-prompt-dismissed";

export type PushPermissionState = "unsupported" | "default" | "granted" | "denied";

export type PushEnableResult =
  | { status: "granted" }
  | { status: "denied" }
  | { status: "unsupported" }
  | { status: "subscription_failed" };

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

// Assumes permission is already "granted" -- creates (or reuses) a
// subscription and registers it with the server. Returns false on any
// failure (missing VAPID key, SW never ready, PushManager rejecting,
// server round trip failing) rather than throwing -- every caller treats a
// failed subscribe as a recoverable, non-fatal state.
async function subscribeToPush(): Promise<boolean> {
  if (!VAPID_PUBLIC_KEY || !("serviceWorker" in navigator) || !("PushManager" in window)) {
    return false;
  }

  try {
    const registration = await getReadyRegistration();
    if (!registration) {
      return false;
    }
    const existing = await registration.pushManager.getSubscription();
    const subscription =
      existing ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
      }));

    const response = await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(subscription.toJSON())
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

  const ok = await subscribeToPush();
  return ok ? { status: "granted" } : { status: "subscription_failed" };
}

// Device-level "the user already said not now" flag -- localStorage (not
// sessionStorage), so it survives reloads/relaunches on this device, per
// the product decision to never nag on every alert enable once dismissed
// once. Not persisted server-side: this is purely "should THIS device's UI
// bother asking again", not account state. Notification.permission itself
// already becomes the durable signal once the user actually grants or
// denies via the browser's own prompt -- this flag only covers the gap
// where they saw our own explainer and chose not to engage with the
// browser prompt at all.
export function hasDismissedPushPrompt(): boolean {
  try {
    return window.localStorage.getItem(DISMISSED_PROMPT_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function markPushPromptDismissed(): void {
  try {
    window.localStorage.setItem(DISMISSED_PROMPT_STORAGE_KEY, "1");
  } catch {
    // Best-effort -- private browsing / storage disabled shouldn't block
    // the alert itself from saving.
  }
}
