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

  const roleByUserId = new Map(roles.map((row) => [row.user_id, row]));
  const demoUserIds = new Set(connections.filter((row) => row.is_demo).map((row) => row.user_id));
  const realUserIds = new Set(
    authUsers
      .filter((user) => {
        const role = roleByUserId.get(user.userId);
        return role?.role !== "admin" && !role?.engagement_excluded && !demoUserIds.has(user.userId);
      })
      .map((user) => user.userId)
  );

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
