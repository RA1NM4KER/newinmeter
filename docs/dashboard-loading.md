# Dashboard loading

The `/` server page resolves authentication, connection lifecycle and feature access. It returns the dashboard shell without waiting for rollups or prompt data. Existing login/connect redirects and cold/restoring behaviour are unchanged.

`useDashboardSections` owns four parallel, deduplicated resources: summary, daily rollups, hourly rollups and prompts. The authenticated `/api/dashboard/[section]` route reuses the existing loaders. Rollup reads still forward the caller's access token and use RLS; prompt reads resolve their owner from the session and honour feature access. Each section has its own rate-limit bucket. No new database objects or aggregation semantics are introduced.

Resources are cached for 30 seconds under the user ID and connection's last-sync timestamp. A successful sync reloads the page as before; its new timestamp separates fresh data from previous cached results. Requests have a 20-second client deadline and receive React Query's cancellation signal. Failures show a Retry action for the affected sections, without replacing completed sections or repeatedly retrying in the background.

Summary controls the date bounds and latest balance. Other metric cards depend on daily rollups, except highest usage hour, which depends on hourly rollups. Day detail and tariffs can render with daily data. Hourly charts can render with hourly data. Daily projection charts and insights wait for both daily and hourly data, preserving the existing calculations. Optional prompt data never holds up charts or metrics.

The full rollup history is shared across all sections and filtered locally through one URL range state. This preserves previous-period comparisons and projection history and avoids new rollup requests on every range change. Pending data is always calculated with the currently selected range. The From/To loading indicators cover pending dashboard resources, URL transitions and observed activity/day-detail requests. A failed request settles loading and exposes retry; an unrelated inactive cached query does not hold the indicators open.
