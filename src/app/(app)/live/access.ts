// Pure Live-page access decision, extracted from page.tsx so the permission
// gate is unit-testable without importing the JSX server component. The page
// maps each outcome to redirect()/notFound()/render.

export type LiveAccessInput = {
  hasSession: boolean;
  liveMeterEnabled: boolean;
  isConnected: boolean;
  isDataWarm: boolean;
};

// "notFound" is deliberately returned for an authenticated user without the
// permission -- the page must behave as though it does not exist, not merely
// deny access.
//
// "restoring" is returned uniformly, even though Live's own pulse data
// (meter_pulses) isn't one of the tables cold storage purges, for the same
// reason every other route redirects during restoration: a predictable
// single destination ("/") while data isn't warm, rather than "well Live
// still technically works because it's a different table."
export type LiveAccess = "login" | "notFound" | "connect" | "restoring" | "ok";

export function resolveLiveAccess({
  hasSession,
  liveMeterEnabled,
  isConnected,
  isDataWarm
}: LiveAccessInput): LiveAccess {
  if (!hasSession) return "login";
  if (!liveMeterEnabled) return "notFound";
  if (!isConnected) return "connect";
  if (!isDataWarm) return "restoring";
  return "ok";
}
