import { redirect } from "next/navigation";

// Retired as a standalone page: restoration now renders as an overlay on
// the dashboard itself (see the (app) layout and RestorationOverlay), not a
// separate route. Kept as a one-line redirect, not deleted outright, purely
// so a stale bookmark or a tab left open from before this change doesn't
// 404 someone.
export default function RestorePage() {
  redirect("/");
}
