import { DiagnosticsSkeleton } from "@/components/admin/diagnostics-skeleton";

export default function AdminDiagnosticsLoading() {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <DiagnosticsSkeleton />
    </div>
  );
}
