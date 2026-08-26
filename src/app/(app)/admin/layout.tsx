import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { AdminSectionTabs } from "@/components/admin/admin-section-tabs";
import { requireAdminSession } from "@/lib/auth/session";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const auth = await requireAdminSession();
  if (!auth.ok) notFound();

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 pt-6">
      <div className="hidden shrink-0 sm:block">
        <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">Admin</h1>
        <p className="mt-1 text-sm text-muted">Manage users, feature access, and system health.</p>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4">
        <AdminSectionTabs />
        {children}
      </div>
    </div>
  );
}
