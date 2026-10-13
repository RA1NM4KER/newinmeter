"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { HealthState } from "@/lib/diagnostics/health";

// The shell retains the last status observed by the Diagnostics route.
// No fetching belongs here: each route owns its own data loading.
const AdminDiagnosticsHealthContext = createContext<{
  health: HealthState | undefined;
  setHealth: (health: HealthState) => void;
}>({ health: undefined, setHealth: () => {} });

export function AdminDiagnosticsHealthProvider({ children }: { children: ReactNode }) {
  const [health, setHealth] = useState<HealthState>();
  const value = useMemo(() => ({ health, setHealth }), [health]);
  return <AdminDiagnosticsHealthContext.Provider value={value}>{children}</AdminDiagnosticsHealthContext.Provider>;
}

export function useAdminDiagnosticsHealth() {
  return useContext(AdminDiagnosticsHealthContext).health;
}

export function PublishAdminDiagnosticsHealth({ health }: { health: HealthState }) {
  const { setHealth } = useContext(AdminDiagnosticsHealthContext);
  useEffect(() => {
    setHealth(health);
  }, [health, setHealth]);
  return null;
}
