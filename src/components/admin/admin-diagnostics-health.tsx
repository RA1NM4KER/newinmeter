"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { usePathname } from "next/navigation";
import { HEALTH_STATES, type HealthState } from "@/lib/diagnostics/health";

type Observation = { health: HealthState; checkedAt: string };
const AdminDiagnosticsHealthContext = createContext<{
  health: HealthState | undefined;
  setHealth: (health: HealthState, checkedAt?: string) => void;
}>({ health: undefined, setHealth: () => {} });

async function fetchHealth(): Promise<Observation> {
  const response = await fetch("/api/admin/diagnostics?section=health", { cache: "no-store" });
  if (!response.ok) throw new Error("Health check unavailable.");
  const data = await response.json();
  if (!HEALTH_STATES.includes(data.health) || !Number.isFinite(Date.parse(data.checkedAt)))
    throw new Error("Invalid health response.");
  return data;
}

export function AdminDiagnosticsHealthProvider({ children }: { children: ReactNode }) {
  const [observed, setObserved] = useState<Observation>();
  const pathname = usePathname();
  // Client-only, cached status check: never holds up the server-rendered Users table.
  const query = useQuery({
    queryKey: ["admin-health-indicator"],
    queryFn: fetchHealth,
    staleTime: 60_000,
    retry: false
  });
  const setHealth = useCallback((health: HealthState, checkedAt = new Date().toISOString()) => {
    setObserved({ health, checkedAt });
  }, []);
  const { data, dataUpdatedAt, refetch } = query;
  useEffect(() => {
    if (pathname === "/admin" && data && Date.now() - dataUpdatedAt > 60_000) void refetch();
  }, [pathname, data, dataUpdatedAt, refetch]);
  const latest =
    observed && (!query.data || Date.parse(observed.checkedAt) > Date.parse(query.data.checkedAt))
      ? observed
      : query.data;
  const health =
    query.isError && (!observed || Date.now() - Date.parse(observed.checkedAt) > 60_000) ? undefined : latest?.health;
  const value = useMemo(() => ({ health, setHealth }), [health, setHealth]);
  return <AdminDiagnosticsHealthContext.Provider value={value}>{children}</AdminDiagnosticsHealthContext.Provider>;
}

export function useAdminDiagnosticsHealth() {
  return useContext(AdminDiagnosticsHealthContext).health;
}

export function PublishAdminDiagnosticsHealth({ health, checkedAt }: { health: HealthState; checkedAt?: string }) {
  const { setHealth } = useContext(AdminDiagnosticsHealthContext);
  useEffect(() => {
    setHealth(health, checkedAt);
  }, [health, checkedAt, setHealth]);
  return null;
}
