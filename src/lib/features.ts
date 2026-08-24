import "server-only";

import { cache } from "react";
import { adminSupabaseFetch, adminSupabaseRequest } from "./supabase-rest";
import { FEATURE_KEYS, FEATURE_META, type FeatureKey, type FeatureMeta, type RolloutMode } from "./newinmeter/features-shared";

// Single source of truth for feature access. Every gating call site in the
// app (route handler, page, cron) goes through hasFeatureAccess or
// getUserFeatureAccess rather than reading a raw column -- see the module
// doc in the Alerts v2/feature-rollout migration for the resolution rule:
//
//   off       -> false, always
//   override  -> the override's value
//   otherwise -> rollout === "everyone"
//
// Overrides are never destroyed by a rollout-mode change (including a trip
// through "off") -- they just stop being consulted while "off" masks them.

type RolloutRow = { feature_key: FeatureKey; rollout_mode: RolloutMode };
type OverrideRow = { user_id: string; feature_key: FeatureKey; enabled: boolean };

const ROLLOUTS_SELECT = "feature_key,rollout_mode";

// cache()'d per request -- every gating check and every admin read hits this,
// and the table is 4 rows, so one fetch per request (not per feature check)
// is the only sane posture.
export const getRolloutModes = cache(async (): Promise<Record<FeatureKey, RolloutMode>> => {
  const rows = await adminSupabaseFetch<RolloutRow[]>(`/feature_rollouts?select=${ROLLOUTS_SELECT}`);
  const modes = Object.fromEntries(FEATURE_KEYS.map((key) => [key, "off" as RolloutMode])) as Record<
    FeatureKey,
    RolloutMode
  >;
  for (const row of rows) {
    modes[row.feature_key] = row.rollout_mode;
  }
  return modes;
});

function resolveEffectiveAccess(mode: RolloutMode, override: boolean | undefined): boolean {
  if (mode === "off") return false;
  if (override !== undefined) return override;
  return mode === "everyone";
}

// Gating check for a single user/feature -- what every route handler, page,
// and cron job should call. cache()'d so repeated checks within one request
// (e.g. a page and the layout it renders under) don't refetch.
export const hasFeatureAccess = cache(async (userId: string, featureKey: FeatureKey): Promise<boolean> => {
  const [modes, overrides] = await Promise.all([
    getRolloutModes(),
    adminSupabaseFetch<OverrideRow[]>(
      `/feature_overrides?select=enabled&user_id=eq.${encodeURIComponent(userId)}&feature_key=eq.${featureKey}&limit=1`
    )
  ]);
  return resolveEffectiveAccess(modes[featureKey], overrides[0]?.enabled);
});

export type FeatureAccessDetail = {
  enabled: boolean;
  // "override" means an explicit per-user row exists for this feature
  // (regardless of whether it currently agrees with the rollout default) --
  // the admin UI uses this to show "individual override" vs "from rollout".
  source: "rollout" | "override";
};

// All 4 features for one user, with provenance -- backs the manage drawer.
export const getUserFeatureAccessDetailed = cache(
  async (userId: string): Promise<Record<FeatureKey, FeatureAccessDetail>> => {
    const [modes, overrides] = await Promise.all([
      getRolloutModes(),
      adminSupabaseFetch<OverrideRow[]>(
        `/feature_overrides?select=feature_key,enabled&user_id=eq.${encodeURIComponent(userId)}`
      )
    ]);
    const overrideByKey = new Map(overrides.map((row) => [row.feature_key, row.enabled]));

    return Object.fromEntries(
      FEATURE_KEYS.map((key) => {
        const override = overrideByKey.get(key);
        return [
          key,
          {
            enabled: resolveEffectiveAccess(modes[key], override),
            source: override !== undefined ? "override" : "rollout"
          } satisfies FeatureAccessDetail
        ];
      })
    ) as Record<FeatureKey, FeatureAccessDetail>;
  }
);

// Bulk resolution for the admin users list -- one rollout fetch + one
// overrides fetch total, regardless of user count (no N+1).
export async function getFeatureAccessForUsers(
  userIds: string[]
): Promise<Map<string, Record<FeatureKey, FeatureAccessDetail>>> {
  if (userIds.length === 0) {
    return new Map();
  }

  const idList = userIds.map((id) => encodeURIComponent(id)).join(",");
  const [modes, overrides] = await Promise.all([
    getRolloutModes(),
    adminSupabaseFetch<OverrideRow[]>(`/feature_overrides?select=user_id,feature_key,enabled&user_id=in.(${idList})`)
  ]);

  const overridesByUser = new Map<string, Map<FeatureKey, boolean>>();
  for (const row of overrides) {
    if (!overridesByUser.has(row.user_id)) {
      overridesByUser.set(row.user_id, new Map());
    }
    overridesByUser.get(row.user_id)!.set(row.feature_key, row.enabled);
  }

  const result = new Map<string, Record<FeatureKey, FeatureAccessDetail>>();
  for (const userId of userIds) {
    const overrideByKey = overridesByUser.get(userId);
    result.set(
      userId,
      Object.fromEntries(
        FEATURE_KEYS.map((key) => {
          const override = overrideByKey?.get(key);
          return [
            key,
            {
              enabled: resolveEffectiveAccess(modes[key], override),
              source: override !== undefined ? "override" : "rollout"
            } satisfies FeatureAccessDetail
          ];
        })
      ) as Record<FeatureKey, FeatureAccessDetail>
    );
  }
  return result;
}

// ---- Admin-only writes. Callers must have already checked requireAdminSession. ----

export async function setRolloutMode(featureKey: FeatureKey, mode: RolloutMode): Promise<void> {
  await adminSupabaseRequest(
    "PATCH",
    `/feature_rollouts?feature_key=eq.${featureKey}`,
    { rollout_mode: mode, updated_at: new Date().toISOString() },
    "return=minimal"
  );
}

// Always writes an explicit row -- toggling a user's access in the admin UI
// is always an explicit decision, never an attempt to "revert to inherited".
// Writes succeed regardless of the feature's current rollout mode (including
// "off"), so overrides set while a feature is off are there waiting the
// moment it returns to "everyone"/"selected".
export async function setUserFeatureOverride(userId: string, featureKey: FeatureKey, enabled: boolean): Promise<void> {
  await adminSupabaseRequest(
    "POST",
    "/feature_overrides?on_conflict=user_id,feature_key",
    [{ user_id: userId, feature_key: featureKey, enabled, updated_at: new Date().toISOString() }],
    "resolution=merge-duplicates,return=minimal"
  );
}

export type FeatureRolloutSummary = {
  key: FeatureKey;
  mode: RolloutMode;
  enabledCount: number;
  totalCount: number;
};

// Backs the Features tab's rows -- counts are EFFECTIVE access (rollout +
// overrides resolved), not raw override rows.
export async function getFeatureRolloutSummaries(allUserIds: string[]): Promise<FeatureRolloutSummary[]> {
  const [modes, access] = await Promise.all([getRolloutModes(), getFeatureAccessForUsers(allUserIds)]);

  return FEATURE_KEYS.map((key) => {
    let enabledCount = 0;
    for (const userId of allUserIds) {
      if (access.get(userId)?.[key]?.enabled) {
        enabledCount += 1;
      }
    }
    return { key, mode: modes[key], enabledCount, totalCount: allUserIds.length };
  });
}

export type FeatureSummaryPayload = FeatureMeta & { mode: RolloutMode; enabledCount: number; totalCount: number };

// Shapes getFeatureRolloutSummaries' output into what the Features tab
// actually renders (name/description alongside mode + counts) -- shared by
// the SSR-initial-data load (admin/page.tsx) and the client refetch route
// (GET /api/admin/features) so the two can never drift.
export function toFeatureSummaryPayload(summaries: FeatureRolloutSummary[]): FeatureSummaryPayload[] {
  return summaries.map((summary) => ({
    ...FEATURE_META[summary.key],
    mode: summary.mode,
    enabledCount: summary.enabledCount,
    totalCount: summary.totalCount
  }));
}

export type FeatureOverrideUser = { userId: string; enabled: boolean };

// The users with an explicit override on this feature (any value) -- backs
// the Features tab's expandable "who has an override" list. Small by
// construction (an admin action created every row here).
export async function listFeatureOverrides(featureKey: FeatureKey): Promise<FeatureOverrideUser[]> {
  const rows = await adminSupabaseFetch<OverrideRow[]>(
    `/feature_overrides?select=user_id,enabled&feature_key=eq.${featureKey}`
  );
  return rows.map((row) => ({ userId: row.user_id, enabled: row.enabled }));
}
