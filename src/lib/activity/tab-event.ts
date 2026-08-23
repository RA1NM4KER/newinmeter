// Activities' tab switch updates the URL via history.replaceState directly
// (see activities-page-client.tsx) rather than router.replace, to avoid
// re-running the force-dynamic /activities server tree just to flip a
// client-side view. That means Next's own useSearchParams() never learns
// the tab changed, so AppShell (which needs to know for lockViewport/mobile
// full-bleed layout) listens for this event instead.
export const ACTIVITIES_TAB_CHANGE_EVENT = "activities-tab-change";
