import { adminUsersColumns } from "@/components/admin/admin-users-columns";
import { AdminCardSkeletonList } from "@/components/admin/admin-card-skeleton-list";
import { StatStripSkeleton } from "@/components/admin/stat-tile";
import { TableSkeletonRows } from "@/components/admin/table-skeleton-rows";
import { MobileSortControlsSkeleton } from "@/components/ui/mobile-sort-controls";
import { Skeleton } from "@/components/ui/skeleton";

export default function AdminLoading() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <StatStripSkeleton />

      <section className="-mx-3 flex h-0 min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-line bg-paper sm:-mx-6 lg:mx-0 lg:rounded-lg lg:border">
        <div className="flex min-h-0 flex-1 flex-col sm:hidden">
          <MobileSortControlsSkeleton />
          <div className="min-h-0 flex-1 overflow-auto">
            <AdminCardSkeletonList count={8} />
          </div>
        </div>

        <div className="hidden min-h-0 flex-1 overflow-auto sm:block">
          <table className="w-full min-w-[760px] border-separate border-spacing-0 text-left text-sm">
            <thead className="sticky top-0 z-10 border-b border-line bg-accentSoft text-xs uppercase tracking-[0.16em] text-brandTeal dark:text-accent shadow-[0_1px_0_rgb(var(--color-line))]">
              <tr>
                {adminUsersColumns.map((column) => (
                  <th className="px-4 py-3 font-medium" key={column.id}>
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              <TableSkeletonRows rowCount={8} />
            </tbody>
          </table>
        </div>
        <div className="flex h-11 shrink-0 items-center justify-between gap-3 border-t border-line px-3">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-9 w-9 rounded-md" />
        </div>
      </section>
    </div>
  );
}
