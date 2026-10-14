"use client";

import { useQuery } from "@tanstack/react-query";
import type { DashboardSection, DashboardSectionData } from "@/lib/dashboard-sections";

export async function fetchDashboardSection<K extends DashboardSection>(
  section: K,
  signal: AbortSignal
): Promise<DashboardSectionData[K]> {
  // iPhone X remains on iOS 16, which lacks AbortSignal.any(). Use the
  // established controller/event APIs so cancellation and deadlines work there.
  const controller = new AbortController();
  const cancel = () => controller.abort();
  if (signal.aborted) cancel();
  else signal.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(cancel, 20_000);
  try {
    const response = await fetch(`/api/dashboard/${section}`, {
      cache: "no-store",
      signal: controller.signal
    });
    if (!response.ok) throw new Error("Unable to load this dashboard section.");
    return await response.json();
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", cancel);
  }
}

function useSection<K extends DashboardSection>(section: K, userId: string, revision: string) {
  return useQuery({
    queryKey: ["dashboard-section", userId, revision, section],
    queryFn: ({ signal }) => fetchDashboardSection(section, signal),
    staleTime: 30_000,
    retry: false,
    refetchOnWindowFocus: false
  });
}

export function useDashboardSections(userId: string, revision: string) {
  // Shared resources, not one request per card. Full history preserves comparisons
  // and projections; date changes filter these same datasets locally.
  const summary = useSection("summary", userId, revision);
  const daily = useSection("daily", userId, revision);
  const hourly = useSection("hourly", userId, revision);
  const prompts = useSection("prompts", userId, revision);
  return { summary, daily, hourly, prompts };
}
