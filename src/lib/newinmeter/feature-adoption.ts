import "server-only";

import { unstable_cache } from "next/cache";
import { getEngagementMetrics } from "../engagement";
import { adminSupabaseFetch } from "../supabase-rest";

export type FeatureAdoption = { aiUsed: boolean; activitiesUsed: boolean };

// Whether this user has ever used the AI assistant or Activities. Used to skip
// prompting a feature the user already has. Returns null on a failed read: the
// caller then shows no feature prompt rather than guessing a feature is unused.
export async function getFeatureAdoption(userId: string, connectionId: string): Promise<FeatureAdoption | null> {
  try {
    const [aiRows, activityRows] = await Promise.all([
      adminSupabaseFetch<unknown[]>(
        `/user_feature_usage?select=user_id&user_id=eq.${encodeURIComponent(userId)}&feature=eq.ai&limit=1`
      ),
      adminSupabaseFetch<unknown[]>(
        `/usage_activities?select=connection_id&connection_id=eq.${encodeURIComponent(connectionId)}&limit=1`
      )
    ]);

    return { aiUsed: aiRows.length > 0, activitiesUsed: activityRows.length > 0 };
  } catch (error) {
    console.error("newinmeter_get_feature_adoption_failed", error instanceof Error ? error.message : error);
    return null;
  }
}

// Share of real users (0-100) who have each feature, from the same calculation
// the admin Engagement tab shows, so the two cannot disagree. Cached for an
// hour: the underlying read covers every user, and adoption moves slowly enough
// that a fresh scan per dashboard load would cost far more than it is worth.
export type FeatureAdoptionRates = { ai: number; activities: number; alerts: number };

export const getFeatureAdoptionRates = unstable_cache(
  async (): Promise<FeatureAdoptionRates> => {
    const metrics = await getEngagementMetrics();
    return {
      ai: metrics.adoption.ai.percentage,
      activities: metrics.adoption.activities.percentage,
      alerts: metrics.adoption.alertsEnabled.percentage
    };
  },
  ["feature-adoption-rates"],
  { revalidate: 3600 }
);
