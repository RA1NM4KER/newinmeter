import { Skeleton } from "@/components/ui/skeleton";
import { adminUsersColumns } from "./admin-users-columns";

export function TableSkeletonRows({ rowCount }: { rowCount: number }) {
  return (
    <>
      {Array.from({ length: rowCount }, (_, rowIndex) => (
        <tr key={`skeleton-${rowIndex}`}>
          {adminUsersColumns.map((column) => (
            <td className="px-4 py-3" key={column.id}>
              <Skeleton className={column.skeletonClassName} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
