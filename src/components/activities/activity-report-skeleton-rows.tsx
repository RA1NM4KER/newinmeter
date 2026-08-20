import { Skeleton } from "@/components/ui/skeleton";
import { activityReportColumns } from "./activity-report-columns";

export function ActivityReportSkeletonRows({ rowCount }: { rowCount: number }) {
  return (
    <>
      {Array.from({ length: rowCount }, (_, rowIndex) => (
        <tr key={`skeleton-${rowIndex}`}>
          {activityReportColumns.map((column) => (
            <td className="px-3 py-3" key={column.id}>
              <Skeleton className={column.skeletonClassName} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
