"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fetchActivityTags } from "@/lib/activity/client";
import { displayActivityTag, normalizeActivityTags } from "@/lib/activity/utils";
import { THRESHOLD_ALERT_TYPES } from "@/lib/newinmeter/alert-types";
import { resolveAssistantDestination } from "@/lib/assistant/navigation";
import { apiEndpoints } from "@/lib/endpoints";
import { formatCurrency } from "@/lib/format";
import type { AssistantAction, TrustedActivitySnapshot } from "@/lib/assistant/types";
import { assistantActionIcon, assistantActionLabel } from "./action-presentation";
import { useAssistant } from "./assistant-provider";
import { useDayDetail } from "./day-detail-provider";

const ALERT_TYPE_LABELS: Record<string, string> = {
  low_balance: "Low balance",
  daily_spend: "Daily spend",
  daily_kwh: "Daily electricity usage",
  data_delayed: "Data delayed",
  balance_runway: "Balance running out soon",
  monthly_budget: "Monthly budget",
  tariff_changed: "Tariff changed",
  tariff_band_approaching: "Approaching tariff band",
  usage_anomaly: "Unusual usage"
};

// Common defaults offered even when the account has no history/suggestion
// of its own yet -- only fills gaps, never displaces a real suggested or
// account tag (see AddActivityCard's chip list building below).
const DEFAULT_TAG_PRESETS = ["geyser", "cooking", "heater", "pool pump"];
const MAX_TAG_CHIPS = 6;

type ActionResult = { ok: true; message: string; data: Record<string, unknown> } | { ok: false; message: string };

async function postAction(body: Record<string, unknown>): Promise<ActionResult> {
  try {
    const response = await fetch(apiEndpoints.assistantActions, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return { ok: false, message: payload.message || "That didn't work. Please try again." };
    }
    return { ok: true, message: "", data: payload as Record<string, unknown> };
  } catch {
    return { ok: false, message: "Network error. Please try again." };
  }
}

function trustedActivitySnapshot(value: unknown): TrustedActivitySnapshot | null {
  if (!value || typeof value !== "object") return null;
  const activity = value as Record<string, unknown>;
  if (
    typeof activity.id !== "string" ||
    typeof activity.startsAt !== "string" ||
    typeof activity.endsAt !== "string" ||
    typeof activity.allDay !== "boolean" ||
    !Array.isArray(activity.tags) ||
    !activity.tags.every((tag) => typeof tag === "string")
  ) {
    return null;
  }
  return {
    id: activity.id,
    startsAt: activity.startsAt,
    endsAt: activity.endsAt,
    allDay: activity.allDay,
    tags: activity.tags
  };
}

function ActionResultBanner({ result }: { result: ActionResult }) {
  return (
    <p className={`flex items-center gap-1.5 text-[0.8125rem] ${result.ok ? "text-brandGreen" : "text-red-600"}`}>
      {result.ok ? <Check className="h-3.5 w-3.5" /> : null}
      {result.message}
    </p>
  );
}

// Shared confirmation-card shell: quiet, no heavy border, generous but not
// admin-form padding. Every confirmation card below uses this instead of
// each inventing its own box.
function ConfirmCard({ children }: { children: ReactNode }) {
  return <div className="rounded-xl bg-canvas/60 p-3.5">{children}</div>;
}

function CardFooter({
  busy,
  confirmLabel,
  confirmDisabled,
  confirmVariant = "primary",
  onCancel,
  onConfirm
}: {
  busy: boolean;
  confirmLabel: string;
  confirmDisabled?: boolean;
  confirmVariant?: "primary" | "danger";
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="mt-3 flex justify-end gap-2">
      <Button onClick={onCancel} size="sm" variant="secondary">
        Cancel
      </Button>
      <Button disabled={busy || confirmDisabled} onClick={onConfirm} size="sm" variant={confirmVariant}>
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : confirmLabel}
      </Button>
    </div>
  );
}

function TagChip({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
        selected
          ? "border border-accent/40 bg-accentSoft text-ink"
          : "border border-line bg-paper text-muted hover:border-accent/30 hover:text-ink"
      }`}
      onClick={onClick}
      type="button"
    >
      {displayActivityTag(label)}
    </button>
  );
}

function AddActivityCard({
  action,
  onDone
}: {
  action: Extract<AssistantAction, { type: "add_activity" }>;
  onDone: () => void;
}) {
  const { recordRecentActionResult } = useAssistant();
  const [accountTags, setAccountTags] = useState<string[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>(normalizeActivityTags(action.suggestedTags));
  const [customOpen, setCustomOpen] = useState(false);
  const [customInput, setCustomInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchActivityTags()
      .then((body) => {
        if (!cancelled) setAccountTags(body.tags);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Suggested tags first (the model's best guess for THIS window), then the
  // account's own real recent tags, then generic presets to fill gaps --
  // never generic presets ahead of the user's own real tags.
  const chipOptions = normalizeActivityTags([
    ...action.suggestedTags,
    ...selectedTags,
    ...accountTags,
    ...DEFAULT_TAG_PRESETS
  ]).slice(0, MAX_TAG_CHIPS);

  function toggleTag(tag: string) {
    setSelectedTags((current) => (current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag]));
  }

  function addCustomTag() {
    const [tag] = normalizeActivityTags([customInput]);
    if (tag) {
      setSelectedTags((current) => (current.includes(tag) ? current : [...current, tag]));
    }
    setCustomInput("");
    setCustomOpen(false);
  }

  async function confirm() {
    if (selectedTags.length === 0 || busy) return;
    setBusy(true);
    const outcome = await postAction({
      type: "add_activity",
      date: action.date,
      start: action.start,
      end: action.end,
      tags: selectedTags
    });
    setBusy(false);
    if (outcome.ok) {
      const activity = trustedActivitySnapshot(outcome.data.activity);
      if (activity) recordRecentActionResult({ type: "add_activity", success: true, activity });
    }
    setResult(outcome.ok ? { ...outcome, message: "Activity added." } : outcome);
  }

  if (result?.ok) {
    return <ActionResultBanner result={result} />;
  }

  return (
    <ConfirmCard>
      <p className="text-sm font-medium text-ink">Add activity</p>
      <p className="mt-0.5 text-xs text-muted">
        {action.date} &middot; {action.start}&ndash;{action.end}
      </p>
      <p className="mb-1.5 mt-3 text-xs text-muted">What was running?</p>
      <div className="flex flex-wrap gap-1.5">
        {chipOptions.map((tag) => (
          <TagChip key={tag} label={tag} onClick={() => toggleTag(tag)} selected={selectedTags.includes(tag)} />
        ))}
        {customOpen ? (
          <input
            autoFocus
            className="h-[1.875rem] w-28 rounded-md border border-line bg-paper px-2 text-xs text-ink outline-none focus:border-accent"
            onBlur={addCustomTag}
            onChange={(event) => setCustomInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addCustomTag();
              }
            }}
            placeholder="Custom"
            value={customInput}
          />
        ) : (
          <button
            aria-label="Add custom tag"
            className="inline-flex items-center gap-0.5 rounded-md border border-dashed border-line px-2 py-1 text-xs text-muted transition hover:border-accent/40 hover:text-ink"
            onClick={() => setCustomOpen(true)}
            type="button"
          >
            <Plus className="h-3 w-3" />
            Other
          </button>
        )}
      </div>
      {result && !result.ok ? <p className="mt-2 text-[0.8125rem] text-red-600">{result.message}</p> : null}
      <CardFooter
        busy={busy}
        confirmDisabled={selectedTags.length === 0}
        confirmLabel="Add activity"
        onCancel={() => {
          setResult(null);
          onDone();
        }}
        onConfirm={() => void confirm()}
      />
    </ConfirmCard>
  );
}

function UpdateActivityCard({
  action,
  onDone
}: {
  action: Extract<AssistantAction, { type: "update_activity" }>;
  onDone: () => void;
}) {
  const { recordRecentActionResult } = useAssistant();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);

  async function confirm() {
    if (busy) return;
    setBusy(true);
    const outcome = await postAction({
      type: "update_activity",
      activityId: action.activityId,
      date: action.date,
      start: action.start,
      end: action.end,
      tags: action.tags,
      note: action.note
    });
    setBusy(false);
    if (outcome.ok) {
      const activity = trustedActivitySnapshot(outcome.data.activity);
      if (activity) recordRecentActionResult({ type: "update_activity", success: true, activity });
    }
    setResult(outcome.ok ? { ...outcome, message: "Activity updated." } : outcome);
  }

  if (result?.ok) {
    return <ActionResultBanner result={result} />;
  }

  return (
    <ConfirmCard>
      <p className="text-sm font-medium text-ink">Update activity</p>
      <p className="mt-0.5 text-xs text-muted">
        {action.date} &middot; {action.start}&ndash;{action.end}
      </p>
      {action.tags.length ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {action.tags.map((tag) => (
            <span className="rounded-md border border-line bg-paper px-2 py-1 text-xs text-muted" key={tag}>
              {displayActivityTag(tag)}
            </span>
          ))}
        </div>
      ) : null}
      {result && !result.ok ? <p className="mt-2 text-[0.8125rem] text-red-600">{result.message}</p> : null}
      <CardFooter
        busy={busy}
        confirmLabel="Update activity"
        onCancel={() => {
          setResult(null);
          onDone();
        }}
        onConfirm={() => void confirm()}
      />
    </ConfirmCard>
  );
}

function DeleteActivityCard({
  action,
  onDone
}: {
  action: Extract<AssistantAction, { type: "delete_activity" }>;
  onDone: () => void;
}) {
  const { recordRecentActionResult } = useAssistant();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);

  async function confirm() {
    if (busy) return;
    setBusy(true);
    const outcome = await postAction({ type: "delete_activity", activityId: action.activityId });
    setBusy(false);
    if (outcome.ok) {
      const deletedActivity = trustedActivitySnapshot(outcome.data.activity);
      if (deletedActivity) recordRecentActionResult({ type: "delete_activity", success: true, deletedActivity });
    }
    setResult(outcome.ok ? { ...outcome, message: "Activity deleted." } : outcome);
  }

  if (result?.ok) {
    return <ActionResultBanner result={result} />;
  }

  return (
    <ConfirmCard>
      <p className="text-sm font-medium text-ink">Delete activity</p>
      <p className="mt-0.5 text-xs text-muted">This can&apos;t be undone.</p>
      {result && !result.ok ? <p className="mt-2 text-[0.8125rem] text-red-600">{result.message}</p> : null}
      <CardFooter
        busy={busy}
        confirmLabel="Delete"
        confirmVariant="danger"
        onCancel={() => {
          setResult(null);
          onDone();
        }}
        onConfirm={() => void confirm()}
      />
    </ConfirmCard>
  );
}

function AlertActionCard({
  action,
  onDone
}: {
  action: Extract<AssistantAction, { type: "set_alert" | "update_alert" | "disable_alert" }>;
  onDone: () => void;
}) {
  const { recordRecentActionResult } = useAssistant();
  const hasThreshold = action.type !== "disable_alert" && THRESHOLD_ALERT_TYPES.includes(action.alertType);
  const [threshold, setThreshold] = useState(
    action.type !== "disable_alert" && action.threshold !== null ? String(action.threshold) : ""
  );
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [autoSyncPrompt, setAutoSyncPrompt] = useState(false);

  const label = ALERT_TYPE_LABELS[action.alertType] ?? action.alertType;
  const parsedThreshold = threshold.trim() ? Number(threshold) : null;

  async function confirm(alsoEnableAutoSync?: boolean) {
    if (busy) return;
    if (hasThreshold && (parsedThreshold === null || !Number.isFinite(parsedThreshold))) return;
    setBusy(true);
    const outcome = await postAction({
      type: action.type,
      alertType: action.alertType,
      ...(action.type !== "disable_alert" ? { threshold: hasThreshold ? parsedThreshold : null } : {}),
      ...(alsoEnableAutoSync ? { alsoEnableAutoSync: true } : {})
    });
    setBusy(false);

    if (!outcome.ok) {
      // The domain layer refuses to silently turn on auto-sync for a
      // fresh-data alert -- surface that as a second, explicit confirmation
      // rather than a dead-end error.
      if (outcome.message.toLowerCase().includes("automatic updates")) {
        setAutoSyncPrompt(true);
        return;
      }
      setResult(outcome);
      return;
    }

    recordRecentActionResult({ type: action.type, success: true, alertType: action.alertType });
    setResult({
      ok: true,
      data: outcome.data,
      message:
        action.type === "disable_alert"
          ? `${label} alert turned off.`
          : hasThreshold && parsedThreshold !== null
            ? `${label} alert set to ${formatCurrency(parsedThreshold)}.`
            : `${label} alert turned on.`
    });
  }

  if (result?.ok) {
    return <ActionResultBanner result={result} />;
  }

  if (autoSyncPrompt) {
    return (
      <ConfirmCard>
        <p className="text-sm font-medium text-ink">Turn on automatic updates?</p>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          {label} needs automatic updates on to keep working. Turn them on now and set this alert?
        </p>
        <CardFooter
          busy={busy}
          confirmLabel="Turn on & set"
          onCancel={() => {
            setAutoSyncPrompt(false);
            onDone();
          }}
          onConfirm={() => void confirm(true)}
        />
      </ConfirmCard>
    );
  }

  return (
    <ConfirmCard>
      <p className="text-sm font-medium text-ink">{label} alert</p>
      <p className="mt-0.5 text-xs text-muted">
        {action.type === "disable_alert"
          ? "Turn this alert off."
          : hasThreshold
            ? "Notify me when this crosses the threshold below."
            : "Notify me when this happens."}
      </p>
      {hasThreshold ? (
        <label className="mt-2.5 flex items-center gap-1.5">
          <span className="text-sm text-muted">R</span>
          <input
            className="h-8 w-28 rounded-md border border-line bg-paper px-2 text-sm text-ink outline-none transition focus:border-accent"
            disabled={busy}
            inputMode="decimal"
            onChange={(event) => setThreshold(event.target.value)}
            value={threshold}
          />
        </label>
      ) : null}
      {result && !result.ok ? <p className="mt-2 text-[0.8125rem] text-red-600">{result.message}</p> : null}
      <CardFooter
        busy={busy}
        confirmDisabled={hasThreshold && (parsedThreshold === null || !Number.isFinite(parsedThreshold))}
        confirmLabel={action.type === "disable_alert" ? "Turn off" : "Set alert"}
        confirmVariant={action.type === "disable_alert" ? "danger" : "primary"}
        onCancel={() => {
          setResult(null);
          onDone();
        }}
        onConfirm={() => void confirm()}
      />
    </ConfirmCard>
  );
}

function SyncActionCard({ onDone }: { onDone: () => void }) {
  const { recordRecentActionResult } = useAssistant();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);

  async function confirm() {
    if (busy) return;
    setBusy(true);
    const outcome = await postAction({ type: "sync" });
    setBusy(false);
    if (outcome.ok) recordRecentActionResult({ type: "sync", success: true });
    setResult(outcome.ok ? { ...outcome, message: "Data refreshed." } : outcome);
  }

  if (result?.ok) {
    return <ActionResultBanner result={result} />;
  }

  return (
    <ConfirmCard>
      <p className="text-sm font-medium text-ink">Refresh data</p>
      <p className="mt-0.5 text-xs text-muted">Sync the latest usage and balance from LiveMopay now.</p>
      {result && !result.ok ? <p className="mt-2 text-[0.8125rem] text-red-600">{result.message}</p> : null}
      <CardFooter busy={busy} confirmLabel="Sync now" onCancel={onDone} onConfirm={() => void confirm()} />
    </ConfirmCard>
  );
}

function ActionButton({ action }: { action: AssistantAction }) {
  const router = useRouter();
  const { close, isActivitiesEnabled, isAlertsEnabled, isDemo } = useAssistant();
  const { openDayDetail } = useDayDetail();
  const [expanded, setExpanded] = useState(false);
  const label = assistantActionLabel(action);
  const Icon = assistantActionIcon(action);

  if (action.type === "navigate") {
    return (
      <Button
        onClick={() => {
          // Close FIRST: the assistant dialog is a global overlay mounted
          // outside page content, so it does NOT unmount on a client-side
          // route change -- without this, the destination page renders
          // underneath a still-open dialog and the click appears to do
          // nothing.
          const destination = resolveAssistantDestination(action.destination);
          close();
          router.push(destination);
        }}
        className="gap-1.5"
        size="sm"
        variant="secondary"
      >
        <Icon aria-hidden="true" className="h-3.5 w-3.5" />
        {label}
      </Button>
    );
  }

  if (action.type === "open_day_detail") {
    return (
      <Button
        onClick={() => {
          // Same "close the overlay first" reasoning as navigate above --
          // opens the shared Day Detail dialog (see DayDetailProvider)
          // rather than leaving the assistant dialog on top of it.
          const { date } = action;
          close();
          openDayDetail(date);
        }}
        className="gap-1.5"
        size="sm"
        variant="secondary"
      >
        <Icon aria-hidden="true" className="h-3.5 w-3.5" />
        {label}
      </Button>
    );
  }

  if (
    (action.type === "add_activity" || action.type === "update_activity" || action.type === "delete_activity") &&
    !isActivitiesEnabled
  ) {
    return null;
  }
  if (
    (action.type === "set_alert" || action.type === "update_alert" || action.type === "disable_alert") &&
    !isAlertsEnabled
  ) {
    return null;
  }
  if (isDemo) {
    return null;
  }

  if (expanded) {
    if (action.type === "add_activity") return <AddActivityCard action={action} onDone={() => setExpanded(false)} />;
    if (action.type === "update_activity")
      return <UpdateActivityCard action={action} onDone={() => setExpanded(false)} />;
    if (action.type === "delete_activity")
      return <DeleteActivityCard action={action} onDone={() => setExpanded(false)} />;
    if (action.type === "sync") return <SyncActionCard onDone={() => setExpanded(false)} />;
    return <AlertActionCard action={action} onDone={() => setExpanded(false)} />;
  }

  return (
    <Button
      className="gap-1.5"
      onClick={() => setExpanded(true)}
      size="sm"
      variant={action.type === "disable_alert" ? "secondary" : "primary"}
    >
      <Icon aria-hidden="true" className="h-3.5 w-3.5" />
      {label}
    </Button>
  );
}

export function AssistantActionRow({ actions }: { actions: AssistantAction[] }) {
  const { isDemo } = useAssistant();
  if (actions.length === 0) {
    return null;
  }

  const hasMutationActions = actions.some((action) => action.type !== "navigate" && action.type !== "open_day_detail");

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {actions.map((action, index) => (
          <ActionButton action={action} key={`${action.type}-${index}`} />
        ))}
      </div>
      {isDemo && hasMutationActions ? <p className="text-xs text-muted">Demo account is read-only.</p> : null}
    </div>
  );
}
