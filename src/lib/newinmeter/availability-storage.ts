import "server-only";
import { withRequestBudget } from "../request-budget";
import { adminSupabaseRequest } from "../supabase-rest";

export async function pruneElectricityObservations(): Promise<number | null> {
  try {
    return await withRequestBudget(1000, () =>
      adminSupabaseRequest<number>("POST", "/rpc/prune_electricity_observations", {})
    );
  } catch {
    console.warn("newinmeter_availability_retention_failed");
    return null;
  }
}
