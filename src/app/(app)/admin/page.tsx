import { notFound } from "next/navigation";
import { AdminUsersTable } from "@/components/admin/admin-users-table";
import { requireAdminSession } from "@/lib/auth/session";
import { listAllUserPermissions } from "@/lib/user-roles";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const auth = await requireAdminSession();
  if (!auth.ok) {
    notFound();
  }

  const rows = await listAllUserPermissions();

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 pt-6">
      <div className="hidden shrink-0 sm:block">
        <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">Admin</h1>
        <p className="mt-1 text-sm text-muted">Manage user roles and permissions.</p>
      </div>

      <AdminUsersTable currentUserId={auth.session.userId} initialData={{ rows, total: rows.length }} />
    </div>
  );
}
