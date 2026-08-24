"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Sun } from "lucide-react";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { UnderlineTabs } from "@/components/ui/underline-tabs";
import { Avatar, IconTile, SettingsGroup, SettingsRow } from "@/components/ui/settings";
import { Button } from "@/components/ui/button";
import { useNotificationCentre } from "@/components/layout/notification-provider";
import { FRESH_DATA_ALERT_TYPES, type AlertType } from "@/lib/newinmeter/alert-types";
import type { AlertInsights, AlertRule } from "@/lib/newinmeter/alerts";
import { queryHref } from "@/lib/url-query";
import { AlertsTab } from "./alerts-tab";
import { BadgePermissionCard } from "./badge-permission-card";
import { ConnectionCard } from "./connection-card";
import { DeleteAccountCard } from "./delete-account-card";
import { isSettingsTabId, settingsTabs, type SettingsTabId } from "./settings-tabs";

type ConnectionProps = {
  status: "connected" | "pending_selection" | "disconnected" | "error" | "not_connected";
  livemopayEmail: string | null;
  accountLabel: string | null;
  lastSyncedAt: string | null;
  isDemo: boolean;
  autoSyncEnabled: boolean;
  nextSyncAt: string | null;
};

const ALERT_LABELS: Record<AlertType, string> = {
  low_balance: "Low balance",
  balance_runway: "Running out soon",
  daily_spend: "Daily spending",
  monthly_budget: "Monthly budget",
  daily_kwh: "Daily electricity",
  tariff_changed: "Tariff changes",
  tariff_band_approaching: "Approaching a higher tariff band",
  usage_anomaly: "Activity prompts",
  data_delayed: "Delayed data"
};

type SettingsPageClientProps = {
  userEmail: string | null;
  avatarInitial: string;
  connection: ConnectionProps;
  alertsEnabled: boolean;
  alertRules: AlertRule[];
  latestBalance: number | null;
  insights: AlertInsights | null;
  suggestedMonthlyBudget: number | null;
  hasTariffProfile: boolean;
};

// All four tab panels are mounted at once, toggled with a CSS class rather
// than conditionally rendered -- unlike Activities' Dashboard/Table (a real
// chart vs. a real data table, each meaningfully expensive), every Settings
// panel here is a lightweight form. Mounting them all means tab switching is
// a pure CSS visibility flip (no state loss, no refetch, no cross-tab sync
// gymnastics) while still keeping ConnectionCard and AlertsTab able to affect
// each other's already-mounted state directly through this component's own
// lifted autoSyncEnabled/alertEnabledByType state.
export function SettingsPageClient({
  userEmail,
  avatarInitial,
  connection,
  alertsEnabled,
  alertRules,
  latestBalance,
  insights,
  suggestedMonthlyBudget,
  hasTariffProfile
}: SettingsPageClientProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { refresh: refreshNotificationCentre } = useNotificationCentre();

  // Alerts is a fully revocable feature -- hidden from the tab list entirely
  // (not shown-disabled) when this user doesn't have it, matching Live
  // Meter's existing "doesn't exist" posture elsewhere in the app.
  const visibleTabs = alertsEnabled ? settingsTabs : settingsTabs.filter((tab) => tab.id !== "alerts");

  const [activeTab, setActiveTabState] = useState<SettingsTabId>(() => {
    const requested = searchParams.get("tab");
    if (requested && isSettingsTabId(requested) && (requested !== "alerts" || alertsEnabled)) {
      return requested;
    }
    return "general";
  });

  const [autoSyncEnabled, setAutoSyncEnabled] = useState(connection.autoSyncEnabled);
  const [nextSyncAt, setNextSyncAt] = useState(connection.nextSyncAt);
  const [alertEnabledByType, setAlertEnabledByType] = useState<Partial<Record<AlertType, boolean>>>(() => {
    const map: Partial<Record<AlertType, boolean>> = {};
    for (const rule of alertRules) {
      map[rule.type] = rule.enabled;
    }
    return map;
  });

  // Same shallow-URL pattern as Activities' Dashboard/Table tabs
  // (activities-page-client.tsx): a router.replace here would trigger a
  // full server round-trip on this force-dynamic page just to flip a
  // client-side view. history.replaceState keeps /settings?tab=... deep-
  // linkable without paying that cost on every tab click.
  function setActiveTab(tab: SettingsTabId) {
    const next = new URLSearchParams(searchParams.toString());
    if (tab === "general") {
      next.delete("tab");
    } else {
      next.set("tab", tab);
    }
    window.history.replaceState(window.history.state, "", queryHref(pathname, next));
    setActiveTabState(tab);
  }

  function handleAlertEnabledChange(type: AlertType, enabled: boolean) {
    setAlertEnabledByType((prev) => ({ ...prev, [type]: enabled }));
    // The notification centre's hasEnabledAlerts/list are fetched once and
    // cached for the session (notification-provider.tsx) -- without this,
    // turning an alert on here and immediately opening the bell would still
    // show the stale "No alerts set up yet." prompt until a full reload.
    refreshNotificationCentre();
  }

  const freshDataAlertsEnabled = FRESH_DATA_ALERT_TYPES.filter((type) => alertEnabledByType[type]).map(
    (type) => ALERT_LABELS[type]
  );

  function handleAutoSyncEnabledChange(next: boolean, nextSyncAtValue?: string | null) {
    setAutoSyncEnabled(next);
    // Both callers now carry a fresh next_sync_at when this changes: the
    // /api/livemopay/auto-sync response (ConnectionCard's own toggle) and
    // upsertAlertRule's response (an AlertRuleRow's alsoEnableAutoSync
    // path) both compute and return it. Data & Sync updates immediately
    // either way, no page reload needed.
    if (nextSyncAtValue !== undefined) {
      setNextSyncAt(nextSyncAtValue);
    }
    if (!next) {
      // Mirrors what the server does in /api/livemopay/auto-sync
      // (disableFreshDataAlertRules) -- kept in sync here so the Alerts tab
      // reflects it immediately rather than waiting for ConnectionCard's
      // router.refresh() to round-trip.
      setAlertEnabledByType((prev) => {
        const updated = { ...prev };
        for (const type of FRESH_DATA_ALERT_TYPES) {
          updated[type] = false;
        }
        return updated;
      });
    }
  }

  return (
    <div className="flex w-full max-w-3xl flex-col gap-6 py-6 sm:py-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">Settings</h1>
        <p className="mt-1.5 text-sm text-muted">Manage your data source, appearance, and account.</p>
      </header>

      <UnderlineTabs tabs={visibleTabs} activeId={activeTab} onChange={(id) => setActiveTab(id as SettingsTabId)} />

      <div className={activeTab === "general" ? "flex flex-col gap-6" : "hidden"}>
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
          <BadgePermissionCard lastSyncedAt={connection.lastSyncedAt} />
        </SettingsGroup>
      </div>

      <div className={activeTab === "data-sync" ? "flex flex-col gap-6" : "hidden"}>
        <ConnectionCard
          status={connection.status}
          livemopayEmail={connection.livemopayEmail}
          accountLabel={connection.accountLabel}
          lastSyncedAt={connection.lastSyncedAt}
          isDemo={connection.isDemo}
          autoSyncEnabled={autoSyncEnabled}
          nextSyncAt={nextSyncAt}
          freshDataAlertsEnabled={freshDataAlertsEnabled}
          onAutoSyncEnabledChange={handleAutoSyncEnabledChange}
        />
      </div>

      {alertsEnabled ? (
        <div className={activeTab === "alerts" ? "flex flex-col gap-6" : "hidden"}>
          <AlertsTab
            rules={alertRules}
            enabledByType={alertEnabledByType}
            autoSyncEnabled={autoSyncEnabled}
            isDemo={connection.isDemo}
            latestBalance={latestBalance}
            insights={insights}
            suggestedMonthlyBudget={suggestedMonthlyBudget}
            hasTariffProfile={hasTariffProfile}
            onEnabledChange={handleAlertEnabledChange}
            onAutoSyncEnabledChange={handleAutoSyncEnabledChange}
          />
        </div>
      ) : null}

      <div className={activeTab === "account" ? "flex flex-col gap-6" : "hidden"}>
        <SettingsGroup label="Account">
          <SettingsRow
            leading={<Avatar>{avatarInitial}</Avatar>}
            title={userEmail ?? "Signed in"}
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

        <DeleteAccountCard isDemo={connection.isDemo} />
      </div>
    </div>
  );
}
