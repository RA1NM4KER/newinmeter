"use client";

import { useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { UnderlineTabs } from "@/components/ui/underline-tabs";
import { queryHref } from "@/lib/url-query";
import { AdminFeaturesPanel } from "./admin-features-panel";
import { AdminUsersTable } from "./admin-users-table";
import type { AdminPageClientProps } from "./types";

type AdminTabId = "users" | "features";

const adminTabs: Array<{ id: AdminTabId; label: string }> = [
  { id: "users", label: "Users" },
  { id: "features", label: "Features" }
];

function isAdminTabId(value: string): value is AdminTabId {
  return adminTabs.some((tab) => tab.id === value);
}

// Same shallow-URL tab pattern as Settings (settings-page-client.tsx): a
// router.replace here would force a full server round-trip on this
// force-dynamic page just to flip a client-side view, so this uses
// history.replaceState directly -- /admin?tab=features stays deep-linkable
// without paying that cost on every click.
export function AdminPageClient({ currentUserId, initialUsers, initialFeatures }: AdminPageClientProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [activeTab, setActiveTabState] = useState<AdminTabId>(() => {
    const requested = searchParams.get("tab");
    return requested && isAdminTabId(requested) ? requested : "users";
  });

  function setActiveTab(tab: AdminTabId) {
    const next = new URLSearchParams(searchParams.toString());
    if (tab === "users") {
      next.delete("tab");
    } else {
      next.set("tab", tab);
    }
    window.history.replaceState(window.history.state, "", queryHref(pathname, next));
    setActiveTabState(tab);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <UnderlineTabs tabs={adminTabs} activeId={activeTab} onChange={(id) => setActiveTab(id as AdminTabId)} />

      <div className={activeTab === "users" ? "flex min-h-0 flex-1 flex-col" : "hidden"}>
        <AdminUsersTable currentUserId={currentUserId} initialData={initialUsers} />
      </div>

      <div className={activeTab === "features" ? "flex flex-col" : "hidden"}>
        <AdminFeaturesPanel initialData={initialFeatures} />
      </div>
    </div>
  );
}
