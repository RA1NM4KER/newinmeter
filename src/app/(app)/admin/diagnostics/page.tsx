import { notFound } from "next/navigation";
import { PublishAdminDiagnosticsHealth } from "@/components/admin/admin-diagnostics-health";
import { DiagnosticsPage } from "@/components/admin/diagnostics-page";
import { requireAdminSession } from "@/lib/auth/session";
import { getDiagnosticsSnapshot } from "@/lib/diagnostics/data";

export const dynamic = "force-dynamic";

export default async function AdminDiagnosticsPage({
  searchParams
}: {
  searchParams?: { connection?: string; event?: string };
}) {
  const auth = await requireAdminSession();
  if (!auth.ok) notFound();

  const snapshot = await getDiagnosticsSnapshot();
  return (
    <>
      <PublishAdminDiagnosticsHealth health={snapshot.overview.overall} />
      <DiagnosticsPage
        snapshot={snapshot}
        selectedConnectionId={searchParams?.connection}
        selectedEventId={searchParams?.event}
      />
    </>
  );
}
