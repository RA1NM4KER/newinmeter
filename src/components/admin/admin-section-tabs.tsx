"use client";

import { useRouter } from "next/navigation";
import { UnderlineTabs } from "@/components/ui/underline-tabs";

export type AdminSectionTabId = "users" | "features" | "diagnostics";

const tabs: Array<{ id: AdminSectionTabId; label: string }> = [
  { id: "users", label: "Users" },
  { id: "features", label: "Features" },
  { id: "diagnostics", label: "Diagnostics" }
];

export function AdminSectionTabs({
  activeId,
  onLocalChange
}: {
  activeId: AdminSectionTabId;
  onLocalChange?: (id: "users" | "features") => void;
}) {
  const router = useRouter();

  function change(id: AdminSectionTabId) {
    if (id === "diagnostics") {
      router.push("/admin/diagnostics");
      return;
    }
    if (onLocalChange) {
      onLocalChange(id);
      return;
    }
    router.push(id === "users" ? "/admin" : "/admin?tab=features");
  }

  return <UnderlineTabs tabs={tabs} activeId={activeId} onChange={(id) => change(id as AdminSectionTabId)} />;
}
