import type { ReactNode } from "react";

export type AppShellProps = {
  children: ReactNode;
  userEmail?: string | null;
  isAdmin?: boolean;
  isActivitiesEnabled?: boolean;
  isLiveMeterEnabled?: boolean;
  isDemo?: boolean;
};

export type ThemeChoice = "system" | "light" | "dark";
