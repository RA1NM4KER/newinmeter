import { notFound } from "next/navigation";
import { DiagnosticsPage } from "@/components/admin/diagnostics-page";
import { requireAdminSession } from "@/lib/auth/session";
import { getDiagnosticsSnapshot } from "@/lib/diagnostics/data";

export const dynamic = "force-dynamic";

export default async function AdminDiagnosticsPage({ searchParams }: { searchParams?: { connection?: string } }) {
  const auth = await requireAdminSession();
  if (!auth.ok) notFound();

  const snapshot = await getDiagnosticsSnapshot();
  return <DiagnosticsPage snapshot={snapshot} selectedConnectionId={searchParams?.connection} />;
}
