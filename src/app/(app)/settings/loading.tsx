"use client";

import { useSearchParams } from "next/navigation";
import { SettingsGroup } from "@/components/ui/settings";
import { Skeleton } from "@/components/ui/skeleton";
import { UnderlineTabs } from "@/components/ui/underline-tabs";
import { isSettingsTabId, settingsTabs, type SettingsTabId } from "@/components/settings/settings-tabs";

// Mirrors the real Settings layout (tabs, then grouped cards, ruled rows) so
// the skeleton reads as the same page mid-load rather than a different one.
// Shows the General tab's content specifically -- the default active tab
// before any URL/client state has loaded. Every control is a placeholder
// here -- nothing is interactive until the data actually arrives.

function IconTileSkeleton() {
  return <Skeleton className="h-9 w-9 shrink-0 rounded-[0.625rem]" />;
}

function RowSkeleton({
  leading,
  titleWidth,
  descWidth,
  control,
  first = false
}: {
  leading: React.ReactNode;
  titleWidth: string;
  descWidth: string;
  control: React.ReactNode;
  first?: boolean;
}) {
  return (
    <div className={`flex items-center gap-4 px-4 py-4 sm:px-5 ${first ? "" : "border-t border-line"}`}>
      {leading}
      <div className="min-w-0 flex-1">
        <Skeleton className={`h-4 ${titleWidth}`} />
        <Skeleton className={`mt-2 h-3 ${descWidth}`} />
      </div>
      <div className="ml-auto shrink-0 pl-2">{control}</div>
    </div>
  );
}

export default function SettingsLoading({ activeTabOverride }: { activeTabOverride?: string | null } = {}) {
  const searchParams = useSearchParams();
  const requestedTab = activeTabOverride ?? searchParams.get("tab");
  const activeTab: SettingsTabId = requestedTab && isSettingsTabId(requestedTab) ? requestedTab : "general";

  return (
    <div className="flex w-full max-w-3xl flex-col gap-6 py-6 sm:py-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">Settings</h1>
        <p className="mt-1.5 text-sm text-muted">Manage your data source, appearance, and account.</p>
      </header>

      <UnderlineTabs tabs={settingsTabs} activeId={activeTab} onChange={() => undefined} />

      {activeTab === "general" ? (
        <SettingsGroup label="General">
          <RowSkeleton
            first
            leading={<IconTileSkeleton />}
            titleWidth="w-28"
            descWidth="w-44"
            control={<Skeleton className="h-9 w-48 rounded-lg" />}
          />
          <RowSkeleton
            leading={<IconTileSkeleton />}
            titleWidth="w-40"
            descWidth="w-64"
            control={<Skeleton className="h-[1.625rem] w-11 rounded-full" />}
          />
        </SettingsGroup>
      ) : null}

      {activeTab === "data-sync" ? (
        <SettingsGroup label="LiveMopay account">
          <div className="p-4 sm:p-5">
            <div className="flex items-center gap-4">
              <IconTileSkeleton />
              <div className="min-w-0 flex-1">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="mt-2 h-3 w-52 max-w-full" />
              </div>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
            <div className="mt-5 border-t border-line pt-4">
              <Skeleton className="h-14 w-full" />
            </div>
            <div className="mt-4 flex gap-3 border-t border-line pt-4">
              <Skeleton className="h-9 w-28 rounded-md" />
              <Skeleton className="h-9 w-24 rounded-md" />
            </div>
          </div>
        </SettingsGroup>
      ) : null}

      {activeTab === "alerts" ? (
        <>
          <div className="rounded-lg border border-line bg-paper p-4">
            <Skeleton className="h-4 w-44" />
            <Skeleton className="mt-2 h-3 w-64 max-w-full" />
          </div>
          {["Balance & spending", "Usage & tariff", "More"].map((label, groupIndex) => (
            <SettingsGroup key={label} label={label}>
              {Array.from({ length: groupIndex === 0 ? 4 : groupIndex === 1 ? 3 : 2 }, (_, index) => (
                <RowSkeleton
                  first={index === 0}
                  key={index}
                  leading={<IconTileSkeleton />}
                  titleWidth="w-36"
                  descWidth="w-64"
                  control={<Skeleton className="h-[1.625rem] w-11 rounded-full" />}
                />
              ))}
            </SettingsGroup>
          ))}
        </>
      ) : null}

      {activeTab === "account" ? (
        <>
          <SettingsGroup label="Account">
            <RowSkeleton
              first
              leading={<Skeleton className="h-9 w-9 shrink-0 rounded-full" />}
              titleWidth="w-48"
              descWidth="w-40"
              control={<Skeleton className="h-9 w-20 rounded-md" />}
            />
          </SettingsGroup>
          <SettingsGroup label="Danger zone" tone="danger">
            <RowSkeleton
              first
              leading={<IconTileSkeleton />}
              titleWidth="w-28"
              descWidth="w-72"
              control={<span />}
            />
            <div className="border-t border-line px-4 py-4 sm:px-5">
              <Skeleton className="h-9 w-full max-w-xs rounded-md" />
              <Skeleton className="mt-4 h-9 w-36 rounded-md" />
            </div>
          </SettingsGroup>
        </>
      ) : null}
    </div>
  );
}
