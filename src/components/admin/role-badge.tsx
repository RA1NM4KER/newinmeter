import type { UserRole } from "@/lib/user-roles";

// Read-only, small on purpose: changing a role is rare and consequential
// enough that it belongs behind an explicit action (the manage drawer), not
// an always-editable inline control taking up a full row on every user.
export function RoleBadge({ role }: { role: UserRole }) {
  const isAdmin = role === "admin";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
        isAdmin ? "bg-accentSoft text-brandTeal dark:text-accent" : "bg-canvas text-muted"
      }`}
    >
      {isAdmin ? "Admin" : "User"}
    </span>
  );
}
