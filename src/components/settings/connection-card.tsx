"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Database } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { IconTile, SettingsGroup } from "@/components/ui/settings";
import { SyncButton } from "@/components/ui/sync-button";
import { isSyncStale } from "@/lib/sync-status";

type ConnectionCardProps = {
  status: "connected" | "pending_selection" | "disconnected" | "error" | "not_connected";
  livemopayEmail: string | null;
  accountLabel: string | null;
  lastSyncedAt: string | null;
  isDemo?: boolean;
};

export function ConnectionCard({
  status,
  livemopayEmail,
  accountLabel,
  lastSyncedAt,
  isDemo = false
}: ConnectionCardProps) {
  const router = useRouter();
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function handleDisconnect() {
    setIsDisconnecting(true);
    try {
      await fetch("/api/livemopay/disconnect", { method: "POST" });
      router.refresh();
    } finally {
      setIsDisconnecting(false);
      setConfirming(false);
    }
  }

  const connected = status === "connected";

  return (
    <SettingsGroup label="Data source">
      <div className="p-4 sm:p-5">
        <div className="flex items-center gap-4">
          <IconTile tone={connected ? "accent" : "default"}>
            <Database size={18} strokeWidth={2} />
          </IconTile>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[0.9375rem] font-semibold text-ink">
              {isDemo ? "Demo dataset" : connected ? (accountLabel ?? "LiveMopay account") : "No account connected"}
            </p>
            <p className="mt-0.5 inline-flex items-center gap-1.5 text-[0.8125rem] text-muted">
              {isDemo ? (
                <>
                  <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />
                  Synthetic data, shared by every reviewer
                </>
              ) : connected ? (
                <>
                  <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden="true" />
                  Connected to LiveMopay
                </>
              ) : status === "not_connected" ? (
                "Connect an account to start importing usage."
              ) : (
                "Disconnected. Your existing history stays available."
              )}
            </p>
          </div>
        </div>

        {isDemo ? (
          <>
            <dl className="mt-5 grid grid-cols-2 gap-4 text-sm">
              <div className="min-w-0">
                <dt className="text-muted">Data source</dt>
                <dd className="mt-1 truncate text-ink">Fixed demo dataset</dd>
              </div>
              <div className="min-w-0">
                <dt className="text-muted">Last synced</dt>
                <dd className="mt-1 truncate text-ink">
                  {lastSyncedAt ? new Date(lastSyncedAt).toLocaleString() : "Not synced yet"}
                </dd>
              </div>
            </dl>

            <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-line pt-4">
              <SyncButton disabled disabledReason="Demo data · Live sync unavailable" />
              <p className="text-[0.8125rem] text-muted">Demo data · Live sync unavailable</p>
            </div>
          </>
        ) : connected ? (
          <>
            <dl className="mt-5 grid grid-cols-2 gap-4 text-sm">
              <div className="min-w-0">
                <dt className="text-muted">LiveMopay email</dt>
                <dd className="mt-1 truncate text-ink">{livemopayEmail ?? "Unknown"}</dd>
              </div>
              <div className="min-w-0">
                <dt className="text-muted">Last synced</dt>
                <dd className="mt-1 truncate text-ink">
                  {lastSyncedAt ? new Date(lastSyncedAt).toLocaleString() : "Not synced yet"}
                </dd>
              </div>
            </dl>

            <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-line pt-4">
              <SyncButton onSuccess={() => window.location.reload()} showNudge={isSyncStale(lastSyncedAt)} />
              <Button variant="dangerGhost" onClick={() => setConfirming(true)}>
                Disconnect
              </Button>
            </div>

            <ConfirmDialog
              open={confirming}
              title="Disconnect LiveMopay?"
              message="Your imported history stays available. You can reconnect this account anytime."
              confirmLabel="Disconnect"
              confirmVariant="danger"
              busy={isDisconnecting}
              onConfirm={() => void handleDisconnect()}
              onCancel={() => setConfirming(false)}
            />
          </>
        ) : (
          <div className="mt-5">
            <Button href="/connect" variant="primary">
              Connect LiveMopay
            </Button>
          </div>
        )}
      </div>
    </SettingsGroup>
  );
}
