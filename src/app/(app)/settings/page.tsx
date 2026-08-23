import { redirect } from "next/navigation";
import { Sun } from "lucide-react";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { AlertsCard } from "@/components/settings/alerts-card";
import { BadgePermissionCard } from "@/components/settings/badge-permission-card";
import { ConnectionCard } from "@/components/settings/connection-card";
import { DeleteAccountCard } from "@/components/settings/delete-account-card";
import { Button } from "@/components/ui/button";
import { Avatar, IconTile, SettingsGroup, SettingsRow } from "@/components/ui/settings";
import { getAuthenticatedSession } from "@/lib/auth/session";
import { getConnectionForUser } from "@/lib/newinmeter/connection";

export const dynamic = "force-dynamic";

// Unlike the dashboard/data pages, Settings is reachable even without an
// active connection -- someone who disconnected still needs a place to
// reconnect, check their account, or sign out.
export default async function SettingsPage() {
  const session = await getAuthenticatedSession();
  if (!session) {
    redirect("/login");
  }

  const connection = await getConnectionForUser(session.userId);
  const initial = (session.email ?? "?").trim().charAt(0).toUpperCase() || "?";

  return (
    <div className="flex w-full max-w-3xl flex-col gap-8 py-6 sm:py-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">Settings</h1>
        <p className="mt-1.5 text-sm text-muted">Manage your data source, appearance, and account.</p>
      </header>

      <SettingsGroup label="General">
        <SettingsRow
          leading={
            <IconTile>
              <Sun size={18} strokeWidth={2} />
            </IconTile>
          }
          title="Appearance"
          description="Theme for this device."
          control={<ThemeToggle />}
        />
        <BadgePermissionCard lastSyncedAt={connection?.lastSyncedAt ?? null} />
      </SettingsGroup>

      <ConnectionCard
        status={connection?.status ?? "not_connected"}
        livemopayEmail={connection?.livemopayEmail ?? null}
        accountLabel={connection?.accountLabel ?? null}
        lastSyncedAt={connection?.lastSyncedAt ?? null}
        isDemo={connection?.isDemo ?? false}
        autoSyncEnabled={connection?.autoSyncEnabled ?? true}
        nextSyncAt={connection?.nextSyncAt ?? null}
      />

      <AlertsCard />

      <SettingsGroup label="Account">
        <SettingsRow
          leading={<Avatar>{initial}</Avatar>}
          title={session.email ?? "Signed in"}
          description="Signed in on this device."
          control={
            <form action="/auth/sign-out" method="post">
              <Button type="submit" variant="secondary">
                Sign out
              </Button>
            </form>
          }
        />
      </SettingsGroup>

      <DeleteAccountCard isDemo={connection?.isDemo ?? false} />
    </div>
  );
}
