"use client";

import { useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { queryHref } from "@/lib/url-query";
import { AdminSectionTabs } from "./admin-section-tabs";
import { AdminFeaturesPanel } from "./admin-features-panel";
import { AdminUsersTable } from "./admin-users-table";
import type { AdminPageClientProps } from "./types";

type AdminTabId = "users" | "features";

function isAdminTabId(value: string): value is AdminTabId {
  return value === "users" || value === "features";
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
      <AdminSectionTabs activeId={activeTab} onLocalChange={setActiveTab} />

      <div className={activeTab === "users" ? "flex min-h-0 flex-1 flex-col" : "hidden"}>
        <AdminUsersTable currentUserId={currentUserId} initialData={initialUsers} />
      </div>

      <div className={activeTab === "features" ? "flex flex-col" : "hidden"}>
        <AdminFeaturesPanel initialData={initialFeatures} />
      </div>
    </div>
  );
}
