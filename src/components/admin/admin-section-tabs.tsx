"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { UnderlineTabs } from "@/components/ui/underline-tabs";
import { healthDotClass, type HealthState } from "@/lib/diagnostics/health";

export type AdminSectionTabId = "users" | "features" | "engagement" | "diagnostics";

function tabs(diagnosticsHealth?: HealthState): Array<{ id: AdminSectionTabId; label: string; indicatorClassName?: string }> {
  return [
    { id: "users", label: "Users" },
    { id: "features", label: "Features" },
    { id: "engagement", label: "Engagement" },
    {
      id: "diagnostics",
      label: "Diagnostics",
      indicatorClassName: diagnosticsHealth ? healthDotClass[diagnosticsHealth] : undefined
    }
  ];
}

const tabHref: Record<AdminSectionTabId, string> = {
  users: "/admin",
  features: "/admin/features",
  engagement: "/admin/engagement",
  diagnostics: "/admin/diagnostics"
};

function tabFromPathname(pathname: string): AdminSectionTabId {
  if (pathname.startsWith("/admin/diagnostics")) return "diagnostics";
  if (pathname.startsWith("/admin/engagement")) return "engagement";
  if (pathname.startsWith("/admin/features")) return "features";
  return "users";
}

export function AdminSectionTabs({ diagnosticsHealth }: { diagnosticsHealth?: HealthState }) {
  const router = useRouter();
  const pathname = usePathname();
  const routeTab = tabFromPathname(pathname);
  const [pendingTab, setPendingTab] = useState<AdminSectionTabId | null>(null);
  const activeId = pendingTab ?? routeTab;

  useEffect(() => {
    if (pendingTab === routeTab) setPendingTab(null);
  }, [pendingTab, routeTab]);

  useEffect(() => {
    for (const href of Object.values(tabHref)) router.prefetch(href);
  }, [router]);

  function change(id: AdminSectionTabId) {
    setPendingTab(id);
    if (id !== routeTab) router.push(tabHref[id], { scroll: false });
  }

  return (
    <UnderlineTabs tabs={tabs(diagnosticsHealth)} activeId={activeId} onChange={(id) => change(id as AdminSectionTabId)} />
  );
}
