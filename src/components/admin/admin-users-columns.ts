// Single source of truth for the admin table's column labels, sort
// capability, and skeleton shape -- shared between the real table
// (admin-users-table.tsx) and its route-level loading skeleton
// (app/(app)/admin/loading.tsx) so the two can never drift out of sync and
// flash a different header between load phases.
export type AdminUsersColumnId = "user" | "joined" | "role" | "features" | "livemopay" | "lastSync";

export type AdminUsersColumn = {
  id: AdminUsersColumnId;
  label: string;
  shortLabel?: string;
  sortable: boolean;
  skeletonClassName: string;
};

export const adminUsersColumns: AdminUsersColumn[] = [
  { id: "user", label: "User", sortable: false, skeletonClassName: "h-4 w-40" },
  { id: "lastSync", label: "Last sync", shortLabel: "Sync", sortable: true, skeletonClassName: "h-4 w-24" },
  { id: "features", label: "Features", sortable: false, skeletonClassName: "h-6 w-32" },
  { id: "role", label: "Role", sortable: false, skeletonClassName: "h-8 w-28" },
  { id: "livemopay", label: "LiveMopay", sortable: false, skeletonClassName: "h-4 w-24" },
  { id: "joined", label: "Joined", sortable: true, skeletonClassName: "h-4 w-20" }
];
