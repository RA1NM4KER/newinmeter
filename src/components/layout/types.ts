import type { ReactNode } from "react";

export type AppShellProps = {
  children: ReactNode;
  userId?: string;
  userEmail?: string | null;
  isAdmin?: boolean;
  isActivitiesEnabled?: boolean;
  isLiveMeterEnabled?: boolean;
  isAiAssistantEnabled?: boolean;
  isAlertsEnabled?: boolean;
  isDemo?: boolean;
  initialUnreadNotificationCount?: number;
};

export type ThemeChoice = "system" | "light" | "dark";
