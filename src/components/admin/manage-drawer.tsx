"use client";

import { Check, Copy, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Switch } from "@/components/ui/switch";
import type { AdminUserListItem } from "@/lib/user-roles";
import { ConnectionStatusBadge } from "./connection-status-badge";
import { LastSyncCell } from "./last-sync-cell";
import { FEATURES, type FeatureDraft } from "./admin-feature-flags";
import type { ManageDrawerProps } from "./types";

function draftFromUser(user: AdminUserListItem): FeatureDraft {
  return {
    aiAssistantEnabled: user.aiAssistantEnabled,
    activitiesEnabled: user.activitiesEnabled,
    liveMeterEnabled: user.liveMeterEnabled
  };
}

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-line px-4 py-3 last:border-b-0">
      <span className="text-sm text-muted">{label}</span>
      <span className="text-sm font-medium text-ink">{children}</span>
    </div>
  );
}

// Exit animation duration; keep in sync with the transition classes below.
const DRAWER_ANIM_MS = 220;

export function ManageDrawer({ user, isSelf, saving, error, onClose, onSave }: ManageDrawerProps) {
  const [draft, setDraft] = useState<FeatureDraft>(() => draftFromUser(user));
  // Drives the slide-in / slide-out. Starts closed, then flips open on the next
  // frame so the browser animates the transform rather than snapping to it.
  const [visible, setVisible] = useState(false);
  const [copied, setCopied] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  async function copyEmail() {
    if (!user.email) {
      return;
    }
    try {
      await navigator.clipboard.writeText(user.email);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be unavailable (insecure context / denied); silently ignore.
    }
  }

  const requestClose = useCallback(() => {
    setVisible(false);
    window.setTimeout(onClose, DRAWER_ANIM_MS); // unmount after the slide-out
  }, [onClose]);

  // Lock body scroll, animate in, focus the close button, close on Escape.
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const raf = requestAnimationFrame(() => setVisible(true));
    closeButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) {
        requestClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [requestClose, saving]);

  const dirty = FEATURES.some((feature) => draft[feature.key] !== user[feature.key]);

  async function handleSave() {
    const changes: Partial<FeatureDraft> = {};
    for (const feature of FEATURES) {
      if (draft[feature.key] !== user[feature.key]) {
        changes[feature.key] = draft[feature.key];
      }
    }
    const ok = await onSave(changes);
    if (ok) {
      requestClose();
    }
  }

  return (
    <div
      className="fixed inset-0 z-50"
      role="dialog"
      aria-modal="true"
      aria-label={`Manage access for ${user.email ?? "user"}`}
    >
      <button
        type="button"
        aria-label="Close"
        onClick={() => !saving && requestClose()}
        className={`absolute inset-0 h-full w-full cursor-default bg-ink/10 backdrop-blur-md transition-opacity duration-200 motion-reduce:transition-none ${
          visible ? "opacity-100" : "opacity-0"
        }`}
      />
      <aside
        className={`absolute right-0 top-0 flex h-full w-[min(28rem,92vw)] flex-col border-l border-line bg-paper shadow-soft transition-transform duration-200 ease-out motion-reduce:transition-none ${
          visible ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="flex min-w-0 flex-1 items-start gap-1.5">
            <h2 className="min-w-0 break-all text-base font-semibold leading-6 text-ink">
              {user.email ?? "Unknown user"}
            </h2>
            {user.email ? (
              <button
                type="button"
                aria-label={copied ? "Email copied" : "Copy email"}
                title={copied ? "Copied" : "Copy email"}
                onClick={() => void copyEmail()}
                className="flex h-6 shrink-0 items-center rounded text-muted outline-none transition hover:text-ink focus-visible:ring-1 focus-visible:ring-line"
              >
                {copied ? <Check className="h-4 w-4 text-accent" /> : <Copy className="h-4 w-4" />}
              </button>
            ) : null}
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            aria-label="Close"
            onClick={() => !saving && requestClose()}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-line bg-canvas text-muted transition hover:text-ink"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-5 py-5">
          <section className="mb-6">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted">Account</h3>
            <div className="overflow-hidden rounded-lg border border-line">
              <InfoRow label="Joined">{new Date(user.createdAt).toLocaleDateString()}</InfoRow>
              <InfoRow label="Role">{user.role === "admin" ? "Admin" : "User"}</InfoRow>
              <InfoRow label="LiveMopay">
                <ConnectionStatusBadge status={user.connectionStatus} />
              </InfoRow>
              <InfoRow label="Last sync">
                <LastSyncCell user={user} />
              </InfoRow>
              <InfoRow label="Auto-sync">
                {user.autoSyncEnabled === null ? (
                  <span className="text-xs text-muted">No connection</span>
                ) : !user.autoSyncEnabled ? (
                  <span className="text-xs text-muted">Off</span>
                ) : (
                  <span className="text-xs text-ink">
                    On
                    {user.nextSyncAt ? ` · next ${new Date(user.nextSyncAt).toLocaleString()}` : " · not scheduled"}
                    {user.lastAutoSyncStatus === "failed" ? " · last attempt failed" : ""}
                  </span>
                )}
              </InfoRow>
            </div>
          </section>

          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted">Features</h3>
            <div className="overflow-hidden rounded-lg border border-line">
              {FEATURES.map((feature) => (
                <div
                  key={feature.key}
                  className="flex items-center justify-between gap-4 border-b border-line px-4 py-3.5 last:border-b-0"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink">{feature.name}</p>
                    <p className="mt-1 text-xs text-muted">{feature.description}</p>
                  </div>
                  <Switch
                    ariaLabel={`${feature.name} for ${user.email ?? "user"}`}
                    checked={draft[feature.key]}
                    onChange={(checked) => setDraft((current) => ({ ...current, [feature.key]: checked }))}
                    disabled={saving}
                  />
                </div>
              ))}
            </div>
            {isSelf ? <p className="mt-3 text-xs text-muted">Editing your own feature access.</p> : null}
            {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
          </section>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-line px-5 py-4">
          <button
            type="button"
            onClick={requestClose}
            disabled={saving}
            className="rounded-md border border-line bg-canvas px-4 py-2 text-sm font-medium text-ink transition hover:bg-paper disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !dirty}
            className="rounded-md bg-brandTeal px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50 dark:bg-accent dark:text-canvas"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </aside>
    </div>
  );
}
