export type NodeId =
  | "livemopay"
  | "session"
  | "scheduler"
  | "sync"
  | "database"
  | "rollups"
  | "alerts"
  | "push"
  | "client"
  | "auth"
  | "ai"
  | "cron";
export type TelemetrySource =
  | "canary"
  | "scheduler"
  | "sync"
  | "database"
  | "rollups"
  | "alerts"
  | "push"
  | "ai"
  | "maintenance"
  | "staleCheck"
  | "session"
  | "unknown";

type SystemNode = {
  id: NodeId;
  label: string;
  subtitle: string;
  description: string;
  source: TelemetrySource;
  x: number;
  y: number;
};

// Operational relationships, not module imports. Keep changes here aligned with
// the runtime references in docs/admin-system-map.md.
export const SYSTEM_NODES: readonly SystemNode[] = [
  {
    id: "livemopay",
    label: "LiveMopay",
    subtitle: "Daily API contract check",
    source: "canary",
    x: 30,
    y: 80,
    description:
      "The external ledger API supplies electricity, water, balance and top-up records. A daily contract canary checks login, refresh, discovery and ledger parsing."
  },
  {
    id: "session",
    label: "Provider session",
    subtitle: "Firebase token refresh",
    source: "session",
    x: 30,
    y: 280,
    description:
      "Each sync refreshes the LiveMopay Firebase session using an encrypted refresh token. Health is inferred from those successes: a recent successful sync or a passing daily contract canary both require a working token refresh. A failure cannot be attributed to the session alone, so this node reports Healthy or Unknown, never Failed."
  },
  {
    id: "scheduler",
    label: "Auto-sync scheduler",
    subtitle: "Supabase pg_cron · 5 min",
    source: "scheduler",
    x: 270,
    y: 280,
    description:
      "Supabase pg_cron and pg_net invoke the auto-sync worker every five minutes. The worker claims due connections with per-account schedules. Its heartbeat measures worker invocation, not every cron job."
  },
  {
    id: "sync",
    label: "Sync worker",
    subtitle: "Fetch · parse · persist",
    source: "sync",
    x: 270,
    y: 80,
    description:
      "Manual and scheduled syncs refresh credentials, fetch the ledger, upsert records and finalize capture runs. Connection health includes scheduling, freshness and reauthentication problems, not just worker errors."
  },
  {
    id: "database",
    label: "Supabase",
    subtitle: "Postgres & stored records",
    source: "database",
    x: 510,
    y: 80,
    description:
      "Postgres stores connections, meter records, capture history and operational diagnostics. A successful diagnostics read confirms this read path only, not every table, write path or database service."
  },
  {
    id: "rollups",
    label: "Derived data",
    subtitle: "Daily & interval rollups",
    source: "rollups",
    x: 510,
    y: 280,
    description:
      "Capture finalization refreshes derived usage data through a synchronous database trigger. Successful captures are indirect evidence of completion, not a separate data-quality or latency probe."
  },
  {
    id: "alerts",
    label: "Alerts engine",
    subtitle: "Rules & evaluation",
    source: "alerts",
    x: 750,
    y: 280,
    description:
      "After sync, alert families evaluate fresh usage and balances. The stale-check job evaluates delayed data. Unresolved evaluation incidents are reported; absence of incidents does not prove health."
  },
  {
    id: "push",
    label: "Push delivery",
    subtitle: "Web Push services",
    source: "push",
    x: 990,
    y: 280,
    description:
      "Web Push sends household alerts and operational notifications to subscribed devices. Delivery reports measure acceptance by push services, not receipt or display on a user's device."
  },
  {
    id: "client",
    label: "NewinMeter",
    subtitle: "Dashboard & PWA",
    source: "unknown",
    x: 990,
    y: 80,
    description:
      "The authenticated client reads usage and derived data through app APIs and receives push notifications through its service worker. There is no fleet-wide browser health probe."
  },
  {
    id: "auth",
    label: "App authentication",
    subtitle: "Supabase Auth",
    source: "unknown",
    x: 750,
    y: 480,
    description:
      "Supabase Auth supplies user sessions; server-side permission checks protect admin and user APIs. An active admin session does not verify signup, email delivery or all users' login paths."
  },
  {
    id: "ai",
    label: "AI assistant",
    subtitle: "OpenAI & scoped tools",
    source: "ai",
    x: 990,
    y: 480,
    description:
      "The assistant calls OpenAI and user-scoped read tools through authenticated app routes. Sampled outcomes and durations come from real requests, including model and tool work. Mutating proposals require user confirmation."
  },
  {
    id: "cron",
    label: "Maintenance jobs",
    subtitle: "Vercel Cron",
    source: "maintenance",
    x: 510,
    y: 480,
    description:
      "Vercel Cron runs stale-check, demo reset and cold-storage maintenance. Each daily job records its own completion outcome. These schedules and heartbeats are separate from pg_cron."
  }
];

type SystemEdge = {
  id: string;
  from: NodeId;
  to: NodeId;
  label: string;
  description: string;
  source: TelemetrySource;
  kind: "data" | "control";
  // Potential impact only. Never infer that the database itself is down
  // because ingestion has stopped, or that an old client cannot read old data.
  propagatesImpact?: boolean;
  path: string;
  // Where the "last success" age is drawn. Edges without room or evidence omit it.
  labelAt?: { x: number; y: number; anchor?: "middle" | "start" | "end" };
};

export const SYSTEM_EDGES: readonly SystemEdge[] = [
  {
    id: "ledger-sync",
    from: "livemopay",
    to: "sync",
    label: "Ledger records",
    source: "sync",
    kind: "data",
    propagatesImpact: true,
    description:
      "Capture runs measure the whole sync pipeline. Their duration and row counts are not isolated LiveMopay network metrics.",
    path: "M210 130 H270",
    labelAt: { x: 240, y: 121 }
  },
  {
    id: "session-sync",
    from: "session",
    to: "sync",
    label: "Refresh session",
    source: "session",
    kind: "control",
    propagatesImpact: true,
    description:
      "The sync worker refreshes a provider session before fetching ledger data. Its health is inferred from successful syncs and the daily contract check, the same evidence as the Provider session node.",
    path: "M120 280 V230 H300 V180"
  },
  {
    id: "schedule-sync",
    from: "scheduler",
    to: "sync",
    label: "Claim due work",
    source: "scheduler",
    kind: "control",
    propagatesImpact: true,
    description:
      "A heartbeat proves worker invocation. It does not mean a connection was due, claimed or successfully synced.",
    path: "M390 280 V180",
    labelAt: { x: 380, y: 235, anchor: "end" }
  },
  {
    id: "sync-database",
    from: "sync",
    to: "database",
    label: "Persist records",
    source: "sync",
    kind: "data",
    description:
      "A successful capture includes persistence and finalization. Upstream failures can affect ingestion without making Postgres unavailable.",
    path: "M450 130 H510",
    labelAt: { x: 480, y: 121 }
  },
  {
    id: "database-rollups",
    from: "database",
    to: "rollups",
    label: "Refresh rollups",
    source: "rollups",
    kind: "data",
    propagatesImpact: true,
    description:
      "Capture finalization runs the rollup trigger synchronously. The capture duration covers the whole pipeline, not just rollup computation.",
    path: "M600 180 V280",
    labelAt: { x: 608, y: 234, anchor: "start" }
  },
  {
    id: "rollups-alerts",
    from: "rollups",
    to: "alerts",
    label: "Evaluate rules",
    source: "alerts",
    kind: "data",
    propagatesImpact: true,
    description:
      "After a successful sync, the alert evaluator uses derived usage and balances. Failures are recorded by alert family.",
    path: "M690 330 H750",
    labelAt: { x: 720, y: 321 }
  },
  {
    id: "alerts-push",
    from: "alerts",
    to: "push",
    label: "Send alerts",
    source: "unknown",
    kind: "data",
    propagatesImpact: true,
    description:
      "Triggered rules send Web Push messages. Global push health also includes operational notifications, so it cannot measure this edge independently.",
    path: "M930 330 H990"
  },
  {
    id: "push-client",
    from: "push",
    to: "client",
    label: "Notify devices",
    source: "unknown",
    kind: "data",
    description:
      "Push-service acceptance does not confirm browser receipt. No device delivery acknowledgement is recorded.",
    path: "M1080 280 V180"
  },
  {
    id: "database-client",
    from: "database",
    to: "client",
    label: "Read through app APIs",
    source: "unknown",
    kind: "data",
    description:
      "Authenticated app APIs read records and derived data for the PWA. There is no independent read latency or error-rate measurement for this path.",
    path: "M690 130 H990"
  },
  {
    id: "cron-alerts",
    from: "cron",
    to: "alerts",
    label: "Check stale data",
    source: "staleCheck",
    kind: "control",
    propagatesImpact: true,
    description: "The Vercel stale-check route evaluates delayed-data alerts independently of successful syncs.",
    path: "M600 480 V430 H840 V380",
    labelAt: { x: 720, y: 422 }
  },
  {
    id: "auth-client",
    from: "auth",
    to: "client",
    label: "Authorize requests",
    source: "unknown",
    kind: "control",
    description:
      "Supabase sessions and server-side authorization guard app requests. This is separate from LiveMopay's Firebase sessions.",
    path: "M870 480 V425 H1200 V210 H1140 V180"
  },
  {
    id: "client-ai",
    from: "client",
    to: "ai",
    label: "Ask assistant",
    source: "ai",
    kind: "control",
    description: "The PWA calls the authenticated assistant endpoint, which orchestrates OpenAI and scoped tools.",
    path: "M1170 150 H1230 V530 H1170"
  },
  {
    id: "database-ai",
    from: "database",
    to: "ai",
    label: "Scoped tool reads",
    source: "ai",
    kind: "data",
    description:
      "Assistant read tools resolve the signed-in user's connection and read only authorized app data. Health follows sampled real assistant requests, which include tool work; it is not a separate read probe.",
    path: "M660 180 V220 H960 V530 H990",
    labelAt: { x: 810, y: 212 }
  }
];

export const MAP_WIDTH = 1260;
export const MAP_HEIGHT = 625;
export const NODE_WIDTH = 180;
export const NODE_HEIGHT = 100;
