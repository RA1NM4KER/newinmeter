"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IconTile, SettingsGroup, SettingsRow } from "@/components/ui/settings";
import { demoCapability } from "@/lib/demo/capabilities";

const confirmPhrase = "DELETE";

export function DeleteAccountCard({ isDemo = false }: { isDemo?: boolean }) {
  const [confirmText, setConfirmText] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState("");

  async function handleDelete() {
    setIsDeleting(true);
    setError("");

    try {
      const response = await fetch("/api/account/delete", { method: "POST" });

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.message || "Couldn't delete your account. Please try again.");
      }

      window.location.href = "/login";
    } catch (caught) {
      setIsDeleting(false);
      setError(caught instanceof Error ? caught.message : "Couldn't delete your account. Please try again.");
    }
  }

  const canDelete = confirmText === confirmPhrase && !isDeleting;

  if (isDemo) {
    return (
      <SettingsGroup label="Danger zone" tone="danger">
        <SettingsRow
          leading={
            <IconTile tone="danger">
              <Trash2 size={18} strokeWidth={2} />
            </IconTile>
          }
          title="Delete account"
          description={demoCapability("accountDeletion").reason}
        />
      </SettingsGroup>
    );
  }

  return (
    <SettingsGroup label="Danger zone" tone="danger">
      <SettingsRow
        leading={
          <IconTile tone="danger">
            <Trash2 size={18} strokeWidth={2} />
          </IconTile>
        }
        title="Delete account"
        description="Permanently removes your connection, every synced row, and your sign-in. Can't be undone."
      />

      <div className="border-t border-line px-4 py-4 sm:px-5">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-muted">
            Type <span className="font-semibold text-ink">{confirmPhrase}</span> to confirm
          </span>
          <input
            className="h-9 w-full max-w-xs rounded-md border border-line bg-canvas px-3 text-sm text-ink outline-none transition focus:border-red-400"
            onChange={(event) => setConfirmText(event.target.value)}
            value={confirmText}
            type="text"
          />
        </label>

        {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}

        <div className="mt-4">
          <Button variant="danger" disabled={!canDelete} onClick={() => void handleDelete()}>
            {isDeleting ? "Deleting…" : "Delete my account"}
          </Button>
        </div>
      </div>
    </SettingsGroup>
  );
}
