"use client";

import { SettingsGroup } from "@/components/ui/settings";
import { Skeleton } from "@/components/ui/skeleton";
import { UnderlineTabs } from "@/components/ui/underline-tabs";
import { settingsTabs } from "@/components/settings/settings-tabs";

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

export default function SettingsLoading() {
  return (
    <div className="flex w-full max-w-3xl flex-col gap-6 py-6 sm:py-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">Settings</h1>
        <p className="mt-1.5 text-sm text-muted">Manage your data source, appearance, and account.</p>
      </header>

      <UnderlineTabs tabs={settingsTabs} activeId="general" onChange={() => undefined} />

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
    </div>
  );
}
