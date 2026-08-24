"use client";

import { ChevronDown, X } from "lucide-react";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { apiEndpoints, buildAdminFeatureUrl, buildAdminFeatureUsersUrl, buildAdminUserPermissionsUrl } from "@/lib/endpoints";
import { ROLLOUT_MODES, type FeatureKey, type RolloutMode } from "@/lib/newinmeter/features-shared";
import type { AdminFeaturesApiResponse, AdminFeaturesPanelProps, FeatureRow } from "./types";

const MODE_LABEL: Record<RolloutMode, string> = {
  everyone: "Everyone",
  selected: "Selected users",
  off: "Off"
};

const queryKey = ["admin-features"];

async function fetchAdminFeatures(): Promise<AdminFeaturesApiResponse> {
  const response = await fetch(apiEndpoints.adminFeatures, { cache: "no-store" });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || "Failed to load features.");
  }
  return (await response.json()) as AdminFeaturesApiResponse;
}

function RolloutSegmented({
  value,
  onChange,
  disabled
}: {
  value: RolloutMode;
  onChange: (mode: RolloutMode) => void;
  disabled?: boolean;
}) {
  return (
    <div className="inline-flex shrink-0 rounded-lg border border-line bg-canvas p-0.5" role="radiogroup">
      {ROLLOUT_MODES.map((mode) => (
        <button
          key={mode}
          type="button"
          role="radio"
          aria-checked={value === mode}
          disabled={disabled}
          onClick={() => onChange(mode)}
          className={`rounded-md px-3 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-60 ${
            value === mode
              ? "bg-brandTeal text-white dark:bg-accent dark:text-canvas"
              : "text-muted hover:text-ink"
          }`}
        >
          {MODE_LABEL[mode]}
        </button>
      ))}
    </div>
  );
}

type OverrideUser = { userId: string; email: string | null; enabled: boolean };

function OverrideList({ featureKey, mode }: { featureKey: FeatureKey; mode: RolloutMode }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-feature-overrides", featureKey],
    queryFn: async () => {
      const response = await fetch(buildAdminFeatureUsersUrl(featureKey), { cache: "no-store" });
      if (!response.ok) {
        const body = await response.text();
        throw new Error(body || "Failed to load overrides.");
      }
      return (await response.json()) as { users: OverrideUser[] };
    }
  });
  const queryClient = useQueryClient();
  const [pendingUserId, setPendingUserId] = useState<string | null>(null);

  // "selected" mode: the only users with access are explicit grants -- show
  // those. "everyone" mode: everyone has access by default, so the
  // interesting exceptions are the explicit revokes.
  const relevant = (data?.users ?? []).filter((user) => (mode === "selected" ? user.enabled : !user.enabled));

  async function revert(userId: string) {
    setPendingUserId(userId);
    try {
      const response = await fetch(buildAdminUserPermissionsUrl(userId), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [featureKey]: mode === "selected" ? false : true })
      });
      if (!response.ok) {
        throw new Error("Couldn't update.");
      }
      await queryClient.invalidateQueries({ queryKey: ["admin-feature-overrides", featureKey] });
      await queryClient.invalidateQueries({ queryKey: ["admin-features"] });
      await queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    } finally {
      setPendingUserId(null);
    }
  }

  if (isLoading) {
    return <p className="text-xs text-muted">Loading…</p>;
  }
  if (error) {
    return <p className="text-xs text-red-600">Could not load overrides.</p>;
  }
  if (relevant.length === 0) {
    return (
      <p className="text-xs text-muted">
        {mode === "selected" ? "No one has been granted access yet." : "No individual revocations."}
      </p>
    );
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {relevant.map((user) => (
        <span
          key={user.userId}
          className="inline-flex items-center gap-1 rounded-full border border-line bg-canvas py-0.5 pl-2.5 pr-1 text-xs text-ink"
        >
          {user.email ?? user.userId}
          <button
            type="button"
            aria-label={`${mode === "selected" ? "Revoke" : "Restore"} access for ${user.email ?? user.userId}`}
            disabled={pendingUserId === user.userId}
            onClick={() => void revert(user.userId)}
            className="inline-flex h-4 w-4 items-center justify-center rounded-full text-muted transition hover:text-ink disabled:opacity-50"
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
    </div>
  );
}

function FeatureRowCard({ feature }: { feature: FeatureRow }) {
  const [expanded, setExpanded] = useState(false);
  const [confirmingOff, setConfirmingOff] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const queryClient = useQueryClient();

  async function applyMode(mode: RolloutMode) {
    setError("");
    setSaving(true);
    queryClient.setQueryData<AdminFeaturesApiResponse | undefined>(queryKey, (current) => {
      if (!current) return current;
      return {
        features: current.features.map((row) => (row.key === feature.key ? { ...row, mode } : row))
      };
    });

    try {
      const response = await fetch(buildAdminFeatureUrl(feature.key), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rolloutMode: mode })
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.message || "Couldn't update rollout.");
      }
      await queryClient.invalidateQueries({ queryKey });
      await queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    } catch (caught) {
      queryClient.setQueryData<AdminFeaturesApiResponse | undefined>(queryKey, (current) => {
        if (!current) return current;
        return {
          features: current.features.map((row) => (row.key === feature.key ? { ...row, mode: feature.mode } : row))
        };
      });
      setError(caught instanceof Error ? caught.message : "Couldn't update rollout.");
    } finally {
      setSaving(false);
    }
  }

  function handleModeChange(mode: RolloutMode) {
    if (mode === feature.mode) return;
    if (mode === "off") {
      setConfirmingOff(true);
      return;
    }
    void applyMode(mode);
  }

  return (
    <div className="border-b border-line last:border-b-0">
      <button
        type="button"
        onClick={() => setExpanded((current) => !current)}
        aria-expanded={expanded}
        className="flex w-full flex-col gap-2 px-4 py-3.5 text-left transition hover:bg-canvas/60 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
      >
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink">{feature.name}</p>
          <p className="mt-0.5 text-xs text-muted">{feature.description}</p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className="text-xs font-medium text-ink">{MODE_LABEL[feature.mode]}</span>
          <span className="text-xs tabular-nums text-muted">
            {feature.enabledCount} / {feature.totalCount}
          </span>
          <ChevronDown className={`h-4 w-4 text-muted transition-transform ${expanded ? "rotate-180" : ""}`} />
        </div>
      </button>

      {expanded ? (
        <div className="flex flex-col gap-3 border-t border-line bg-canvas/40 px-4 py-4">
          <RolloutSegmented value={feature.mode} onChange={handleModeChange} disabled={saving} />
          {error ? <p className="text-xs text-red-600">{error}</p> : null}
          {feature.mode !== "off" ? (
            <OverrideList featureKey={feature.key} mode={feature.mode} />
          ) : (
            <p className="text-xs text-muted">
              Nobody has access while this feature is off. Individual overrides are preserved and take effect again
              once this returns to Everyone or Selected users.
            </p>
          )}
          {feature.mode === "selected" ? (
            <p className="text-xs text-muted/70">Grant access to more users from the Users tab.</p>
          ) : null}
        </div>
      ) : null}

      <ConfirmDialog
        open={confirmingOff}
        title={`Turn off ${feature.name}?`}
        message="This immediately removes access for everyone, including future users. Individual overrides are preserved and restored automatically when this returns to Everyone or Selected users."
        confirmLabel="Turn off"
        confirmVariant="danger"
        busy={saving}
        onConfirm={() => {
          setConfirmingOff(false);
          void applyMode("off");
        }}
        onCancel={() => setConfirmingOff(false)}
      />
    </div>
  );
}

// Features tab: one compact row per feature (name, description, rollout
// mode, effective-access count), reusing the same understated card language
// as the rest of Settings/Admin -- no dashboard cards, no gradients.
// Clicking a row exposes its rollout control and (mode-appropriate)
// override list, rather than showing the segmented control on every row at
// all times.
export function AdminFeaturesPanel({ initialData }: AdminFeaturesPanelProps) {
  const { data } = useQuery({ queryKey, queryFn: fetchAdminFeatures, initialData });
  const features = data?.features ?? [];

  return (
    <Card className="overflow-hidden">
      {features.map((feature) => (
        <FeatureRowCard key={feature.key} feature={feature} />
      ))}
    </Card>
  );
}
