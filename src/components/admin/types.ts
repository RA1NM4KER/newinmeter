import type { AdminUserListItem } from "@/lib/user-roles";
import type { FeatureDraft } from "./admin-feature-flags";

export type AdminUsersApiResponse = {
  rows: AdminUserListItem[];
  total: number;
};

export type AdminUsersTableProps = {
  currentUserId: string;
  initialData: AdminUsersApiResponse;
};

export type StatTileProps = { label: string; value: number; tone?: "default" | "warning" };

export type ManageDrawerProps = {
  user: AdminUserListItem;
  isSelf: boolean;
  saving: boolean;
  error: string;
  onClose: () => void;
  // Resolves true when the save succeeded, so the drawer can animate itself out.
  onSave: (changes: Partial<FeatureDraft>) => Promise<boolean>;
};
