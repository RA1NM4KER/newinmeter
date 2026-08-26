import { adminUsersColumns } from "@/components/admin/admin-users-columns";
import { StatStripSkeleton } from "@/components/admin/stat-tile";
import { TableSkeletonRows } from "@/components/admin/table-skeleton-rows";
import { Card } from "@/components/ui/card";

export default function AdminLoading() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <StatStripSkeleton />

      <Card className="flex h-0 min-h-0 flex-1 flex-col overflow-hidden">
        <div className="min-h-0 flex-1 overflow-auto">
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
      </Card>
    </div>
  );
}
