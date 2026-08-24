import type { ReactNode } from "react";
import type { AdminUserListItem } from "@/lib/user-roles";
import type { FeatureKey, RolloutMode } from "@/lib/newinmeter/features-shared";

export type AdminUsersApiResponse = {
  rows: AdminUserListItem[];
  total: number;
};

export type FeatureRow = {
  key: FeatureKey;
  name: string;
  short: string;
  description: string;
  mode: RolloutMode;
  enabledCount: number;
  totalCount: number;
};

export type AdminFeaturesApiResponse = {
  features: FeatureRow[];
};

export type AdminPageClientProps = {
  currentUserId: string;
  initialUsers: AdminUsersApiResponse;
  initialFeatures: AdminFeaturesApiResponse;
};

export type AdminUsersTableProps = {
  currentUserId: string;
  initialData: AdminUsersApiResponse;
};

export type AdminFeaturesPanelProps = {
  initialData: AdminFeaturesApiResponse;
};

export type StatTileProps = { label: ReactNode; value: number; tone?: "default" | "warning" };

// Draft toggle state in the manage drawer -- always written as an explicit
// per-user override on save (see setUserFeatureOverride).
export type FeatureDraft = Record<FeatureKey, boolean>;

export type ManageDrawerProps = {
  user: AdminUserListItem;
  isSelf: boolean;
  saving: boolean;
  error: string;
  onClose: () => void;
  // Resolves true when the save succeeded, so the drawer can animate itself out.
  onSave: (changes: Partial<FeatureDraft>) => Promise<boolean>;
};
