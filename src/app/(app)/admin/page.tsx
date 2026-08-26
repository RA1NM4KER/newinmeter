import { notFound, redirect } from "next/navigation";
import { AdminUsersTable } from "@/components/admin/admin-users-table";
import { requireAdminSession } from "@/lib/auth/session";
import { listAllUserPermissions } from "@/lib/user-roles";

export const dynamic = "force-dynamic";

export default async function AdminPage({ searchParams }: { searchParams?: { tab?: string } }) {
  // Preserve old Features deep links after moving each Admin tab to a real
  // child route under the persistent Admin layout.
  if (searchParams?.tab === "features") redirect("/admin/features");

  const auth = await requireAdminSession();
  if (!auth.ok) notFound();

  const rows = await listAllUserPermissions();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <AdminUsersTable currentUserId={auth.session.userId} initialData={{ rows, total: rows.length }} />
    </div>
  );
}
