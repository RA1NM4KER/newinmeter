import { SettingsGroup } from "@/components/ui/settings";
import { Skeleton } from "@/components/ui/skeleton";

// Mirrors the real Settings layout (single column, grouped cards, ruled rows)
// so the skeleton reads as the same page mid-load rather than a different one.
// Every control is a placeholder here -- no live ThemeToggle or delete form --
// so nothing is interactive until the data actually arrives.

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
    <div className="flex w-full max-w-3xl flex-col gap-8 py-6 sm:py-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">Settings</h1>
        <p className="mt-1.5 text-sm text-muted">Manage your data source, appearance, and account.</p>
      </header>

      <SettingsGroup label="Data source">
        <div className="p-4 sm:p-5">
          <div className="flex items-center gap-4">
            <IconTileSkeleton />
            <div className="min-w-0 flex-1">
              <Skeleton className="h-4 w-44" />
              <Skeleton className="mt-2 h-3 w-36" />
            </div>
          </div>
          <dl className="mt-5 grid grid-cols-2 gap-4">
            <div>
              <Skeleton className="h-3 w-28" />
              <Skeleton className="mt-2 h-4 w-40" />
            </div>
            <div>
              <Skeleton className="h-3 w-24" />
              <Skeleton className="mt-2 h-4 w-32" />
            </div>
          </dl>
          <div className="mt-5 flex items-center gap-3 border-t border-line pt-4">
            <Skeleton className="h-9 w-24" />
            <Skeleton className="h-9 w-28" />
          </div>
        </div>
      </SettingsGroup>

      <SettingsGroup label="Preferences">
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

      <SettingsGroup label="Account">
        <RowSkeleton
          first
          leading={<Skeleton className="h-9 w-9 shrink-0 rounded-full" />}
          titleWidth="w-52"
          descWidth="w-36"
          control={<Skeleton className="h-9 w-20" />}
        />
      </SettingsGroup>

      <SettingsGroup label="Danger zone" tone="danger">
        <RowSkeleton first leading={<IconTileSkeleton />} titleWidth="w-32" descWidth="w-72" control={null} />
        <div className="border-t border-line px-4 py-4 sm:px-5">
          <Skeleton className="h-3 w-40" />
          <Skeleton className="mt-2 h-9 w-full max-w-xs rounded-md" />
          <Skeleton className="mt-4 h-9 w-36" />
        </div>
      </SettingsGroup>
    </div>
  );
}
