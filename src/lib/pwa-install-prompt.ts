// Device-local "the user dismissed an install/phone-alerts promotion"
// signal, shared by AlertRuleRow's contextual iOS setup prompt and the
// dashboard's install promo card. A timestamp + cooldown, not a forever
// boolean -- declining once must not permanently bury the promotion, only
// suppress it for a while. Distinct from push-client.ts's
// device-notifications-dismissed flag, which is specifically about "keep
// device push off" and is cleared the moment push turns on -- this one is
// about the install/setup nudge itself, unrelated to push subscription
// state.
const INSTALL_PROMO_DISMISSED_AT_KEY = "newinmeter:install-promo-dismissed-at";
const COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

export function dismissInstallPromo(): void {
  try {
    window.localStorage.setItem(INSTALL_PROMO_DISMISSED_AT_KEY, String(Date.now()));
  } catch {
    // Best-effort -- private browsing / storage disabled shouldn't block
    // whatever action the dismissal accompanies.
  }
}

export function isInstallPromoCoolingDown(): boolean {
  try {
    const raw = window.localStorage.getItem(INSTALL_PROMO_DISMISSED_AT_KEY);
    if (!raw) {
      return false;
    }
    const dismissedAt = Number(raw);
    if (!Number.isFinite(dismissedAt)) {
      return false;
    }
    return Date.now() - dismissedAt < COOLDOWN_MS;
  } catch {
    return false;
  }
}
