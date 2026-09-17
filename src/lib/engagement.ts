import "server-only";

import { adminSupabaseFetch, adminSupabaseFetchAllPages, adminSupabaseRequest } from "./supabase-rest";
import { listAllAuthUsers } from "./user-roles";

const DAY_MS = 24 * 60 * 60 * 1000;
const ENGAGEMENT_TIME_ZONE = "Africa/Johannesburg";

type UserRoleRow = {
  user_id: string;
  role: "admin" | "user";
  engagement_excluded: boolean;
};

type ConnectionRow = {
  id: string;
  user_id: string;
  status: "connected" | "pending_selection" | "disconnected" | "error";
  is_demo: boolean;
  updated_at: string;
};

type ConnectionOwnedRow = { connection_id: string };
type UserOwnedRow = { user_id: string };
type ActivityDayRow = UserOwnedRow & { activity_date: string };

export type AdoptionMetric = {
  users: number;
  percentage: number;
};

export type EngagementMetrics = {
  totalRealUsers: number;
  activeToday: number;
  activeLast7Days: number;
  activeLast30Days: number;
  adoption: {
    activities: AdoptionMetric;
    alertsEnabled: AdoptionMetric;
    push: AdoptionMetric;
    ai: AdoptionMetric;
    livemopay: AdoptionMetric;
  };
};

const localDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: ENGAGEMENT_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

export function engagementDateRange(now: Date = new Date()) {
  const today = localDateFormatter.format(now);
  const [year, month, day] = today.split("-").map(Number);
  const todayUtc = Date.UTC(year, month - 1, day);
  const dateDaysAgo = (days: number) => new Date(todayUtc - days * DAY_MS).toISOString().slice(0, 10);

  return {
    today,
    last7DaysStart: dateDaysAgo(6),
    last30DaysStart: dateDaysAgo(29)
  };
}

function adoptionMetric(userIds: Set<string>, realUserIds: Set<string>): AdoptionMetric {
  let users = 0;
  userIds.forEach((userId) => {
    if (realUserIds.has(userId)) users += 1;
  });

  return {
    users,
    percentage: realUserIds.size ? Math.round((users / realUserIds.size) * 100) : 0
  };
}

// Shared with getAdoptionMetricUsers below so "who counts as a real user"
// can never drift between the summary count and its drill-down list.
function resolveRealUserIds(
  authUsers: Array<{ userId: string; email: string | null }>,
  roles: UserRoleRow[],
  connections: ConnectionRow[]
): Set<string> {
  const roleByUserId = new Map(roles.map((row) => [row.user_id, row]));
  const demoUserIds = new Set(connections.filter((row) => row.is_demo).map((row) => row.user_id));

  return new Set(
    authUsers
      .filter((user) => {
        const role = roleByUserId.get(user.userId);
        return role?.role !== "admin" && !role?.engagement_excluded && !demoUserIds.has(user.userId);
      })
      .map((user) => user.userId)
  );
}

export async function recordAiFeatureUsage(userId: string): Promise<void> {
  await adminSupabaseRequest(
    "POST",
    "/rpc/record_user_feature_usage",
    { p_user_id: userId, p_feature: "ai" },
    "return=minimal"
  );
}

export async function getEngagementMetrics(now: Date = new Date()): Promise<EngagementMetrics> {
  const dates = engagementDateRange(now);
  const [authUsers, roles, connections, activityDays, activities, enabledAlerts, subscriptions, aiUsage] =
    await Promise.all([
      listAllAuthUsers(),
      adminSupabaseFetch<UserRoleRow[]>("/user_roles?select=user_id,role,engagement_excluded"),
      adminSupabaseFetch<ConnectionRow[]>(
        "/livemopay_connections?select=id,user_id,status,is_demo,updated_at&order=updated_at.desc"
      ),
      adminSupabaseFetchAllPages<ActivityDayRow>(
        `/user_activity_days?select=user_id,activity_date&activity_date=gte.${dates.last30DaysStart}`
      ),
      adminSupabaseFetchAllPages<ConnectionOwnedRow>("/usage_activities?select=connection_id"),
      adminSupabaseFetchAllPages<ConnectionOwnedRow>("/alert_rules?select=connection_id&enabled=eq.true"),
      adminSupabaseFetchAllPages<UserOwnedRow>("/push_subscriptions?select=user_id"),
      adminSupabaseFetchAllPages<UserOwnedRow>("/user_feature_usage?select=user_id&feature=eq.ai")
    ]);

  const realUserIds = resolveRealUserIds(authUsers, roles, connections);

  const userIdByConnectionId = new Map(connections.map((row) => [row.id, row.user_id]));
  const ownersOf = (rows: ConnectionOwnedRow[]) => {
    const userIds = new Set<string>();
    for (const row of rows) {
      const userId = userIdByConnectionId.get(row.connection_id);
      if (userId) userIds.add(userId);
    }
    return userIds;
  };

  const latestConnectionByUserId = new Map<string, ConnectionRow>();
  for (const connection of connections) {
    if (!latestConnectionByUserId.has(connection.user_id)) latestConnectionByUserId.set(connection.user_id, connection);
  }

  const usersActiveSince = (startDate: string) =>
    new Set(
      activityDays
        .filter((row) => row.activity_date >= startDate && realUserIds.has(row.user_id))
        .map((row) => row.user_id)
    ).size;

  const connectedUserIds = new Set(
    Array.from(latestConnectionByUserId.values())
      .filter((connection) => connection.status === "connected" && !connection.is_demo)
      .map((connection) => connection.user_id)
  );

  return {
    totalRealUsers: realUserIds.size,
    activeToday: usersActiveSince(dates.today),
    activeLast7Days: usersActiveSince(dates.last7DaysStart),
    activeLast30Days: usersActiveSince(dates.last30DaysStart),
    adoption: {
      activities: adoptionMetric(ownersOf(activities), realUserIds),
      alertsEnabled: adoptionMetric(ownersOf(enabledAlerts), realUserIds),
      push: adoptionMetric(new Set(subscriptions.map((row) => row.user_id)), realUserIds),
      ai: adoptionMetric(new Set(aiUsage.map((row) => row.user_id)), realUserIds),
      livemopay: adoptionMetric(connectedUserIds, realUserIds)
    }
  };
}

export const ADOPTION_METRIC_KEYS = ["activities", "alertsEnabled", "push", "ai", "livemopay"] as const;

export type AdoptionMetricKey = (typeof ADOPTION_METRIC_KEYS)[number];

export function isAdoptionMetricKey(value: string): value is AdoptionMetricKey {
  return (ADOPTION_METRIC_KEYS as readonly string[]).includes(value);
}

export type AdoptionMetricUser = { userId: string; email: string | null };

// Backs the Feature-adoption row's expandable "who has this" list. Fetches
// only what's needed for the one requested metric rather than the full
// getEngagementMetrics payload, mirroring listFeatureOverrides's per-feature
// fetch on the Features tab.
export async function getAdoptionMetricUsers(key: AdoptionMetricKey): Promise<AdoptionMetricUser[]> {
  const [authUsers, roles, connections] = await Promise.all([
    listAllAuthUsers(),
    adminSupabaseFetch<UserRoleRow[]>("/user_roles?select=user_id,role,engagement_excluded"),
    adminSupabaseFetch<ConnectionRow[]>(
      "/livemopay_connections?select=id,user_id,status,is_demo,updated_at&order=updated_at.desc"
    )
  ]);

  const realUserIds = resolveRealUserIds(authUsers, roles, connections);
  const userIdByConnectionId = new Map(connections.map((row) => [row.id, row.user_id]));
  const ownersOf = (rows: ConnectionOwnedRow[]) => {
    const userIds = new Set<string>();
    for (const row of rows) {
      const userId = userIdByConnectionId.get(row.connection_id);
      if (userId) userIds.add(userId);
    }
    return userIds;
  };

  let matchingUserIds: Set<string>;

  switch (key) {
    case "activities": {
      const activities = await adminSupabaseFetchAllPages<ConnectionOwnedRow>("/usage_activities?select=connection_id");
      matchingUserIds = ownersOf(activities);
      break;
    }
    case "alertsEnabled": {
      const enabledAlerts = await adminSupabaseFetchAllPages<ConnectionOwnedRow>(
        "/alert_rules?select=connection_id&enabled=eq.true"
      );
      matchingUserIds = ownersOf(enabledAlerts);
      break;
    }
    case "push": {
      const subscriptions = await adminSupabaseFetchAllPages<UserOwnedRow>("/push_subscriptions?select=user_id");
      matchingUserIds = new Set(subscriptions.map((row) => row.user_id));
      break;
    }
    case "ai": {
      const aiUsage = await adminSupabaseFetchAllPages<UserOwnedRow>("/user_feature_usage?select=user_id&feature=eq.ai");
      matchingUserIds = new Set(aiUsage.map((row) => row.user_id));
      break;
    }
    case "livemopay": {
      const latestConnectionByUserId = new Map<string, ConnectionRow>();
      for (const connection of connections) {
        if (!latestConnectionByUserId.has(connection.user_id)) latestConnectionByUserId.set(connection.user_id, connection);
      }
      matchingUserIds = new Set(
        Array.from(latestConnectionByUserId.values())
          .filter((connection) => connection.status === "connected" && !connection.is_demo)
          .map((connection) => connection.user_id)
      );
      break;
    }
  }

  const emailByUserId = new Map(authUsers.map((user) => [user.userId, user.email]));

  return Array.from(matchingUserIds)
    .filter((userId) => realUserIds.has(userId))
    .map((userId) => ({ userId, email: emailByUserId.get(userId) ?? null }))
    .sort((a, b) => (a.email ?? "").localeCompare(b.email ?? ""));
}
