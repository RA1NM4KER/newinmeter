"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { THRESHOLD_ALERT_TYPES } from "@/lib/newinmeter/alert-types";
import { resolveAssistantDestination } from "@/lib/assistant/navigation";
import { apiEndpoints } from "@/lib/endpoints";
import { formatCurrency } from "@/lib/format";
import type { AssistantAction } from "@/lib/assistant/types";
import { useAssistant } from "./assistant-provider";

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

type ActionResult = { ok: true; message: string } | { ok: false; message: string };

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
    return { ok: true, message: "" };
  } catch {
    return { ok: false, message: "Network error. Please try again." };
  }
}

function ActionResultBanner({ result }: { result: ActionResult }) {
  return (
    <p className={`flex items-center gap-1.5 text-[0.8125rem] ${result.ok ? "text-brandGreen" : "text-red-600"}`}>
      {result.ok ? <Check className="h-3.5 w-3.5" /> : null}
      {result.ok ? result.message : result.message}
    </p>
  );
}

function AddActivityCard({
  action,
  onDone
}: {
  action: Extract<AssistantAction, { type: "add_activity" }>;
  onDone: () => void;
}) {
  const [tagsInput, setTagsInput] = useState(action.suggestedTags.join(", "));
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);

  const tags = tagsInput
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);

  async function confirm() {
    if (tags.length === 0 || busy) return;
    setBusy(true);
    const outcome = await postAction({
      type: "add_activity",
      date: action.date,
      start: action.start,
      end: action.end,
      tags
    });
    setBusy(false);
    setResult(outcome.ok ? { ok: true, message: "Activity added." } : outcome);
  }

  if (result?.ok) {
    return <ActionResultBanner result={result} />;
  }

  return (
    <div className="rounded-md border border-line bg-paper p-3">
      <p className="text-sm font-medium text-ink">Add activity</p>
      <p className="mt-0.5 text-xs text-muted">
        {action.date} &middot; {action.start}&ndash;{action.end}
      </p>
      <label className="mt-2 block">
        <span className="mb-1 block text-xs text-muted">Tags</span>
        <input
          className="h-9 w-full rounded-md border border-line bg-canvas px-2.5 text-sm text-ink outline-none transition focus:border-accent"
          disabled={busy}
          onChange={(event) => setTagsInput(event.target.value)}
          placeholder="e.g. geyser"
          value={tagsInput}
        />
      </label>
      {result && !result.ok ? <p className="mt-2 text-[0.8125rem] text-red-600">{result.message}</p> : null}
      <div className="mt-3 flex gap-2">
        <Button
          onClick={() => {
            setResult(null);
            onDone();
          }}
          size="sm"
          variant="secondary"
        >
          Cancel
        </Button>
        <Button disabled={busy || tags.length === 0} onClick={() => void confirm()} size="sm" variant="primary">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Add activity"}
        </Button>
      </div>
    </div>
  );
}

function AlertActionCard({
  action,
  onDone
}: {
  action: Extract<AssistantAction, { type: "set_alert" | "update_alert" | "disable_alert" }>;
  onDone: () => void;
}) {
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

    setResult({
      ok: true,
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
      <div className="rounded-md border border-line bg-paper p-3">
        <p className="text-sm font-medium text-ink">Turn on automatic updates?</p>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          {label} needs automatic updates on to keep working. Turn them on now and set this alert?
        </p>
        <div className="mt-3 flex gap-2">
          <Button
            onClick={() => {
              setAutoSyncPrompt(false);
              onDone();
            }}
            size="sm"
            variant="secondary"
          >
            Cancel
          </Button>
          <Button disabled={busy} onClick={() => void confirm(true)} size="sm" variant="primary">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Turn on & set alert"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-line bg-paper p-3">
      <p className="text-sm font-medium text-ink">
        {action.type === "disable_alert" ? `Turn off ${label.toLowerCase()} alert` : `${label} alert`}
      </p>
      {action.type !== "disable_alert" ? (
        <p className="mt-0.5 text-xs text-muted">Notify me when this crosses the threshold below.</p>
      ) : null}
      {hasThreshold ? (
        <label className="mt-2 flex items-center gap-2">
          <span className="text-sm text-muted">R</span>
          <input
            className="h-9 w-32 rounded-md border border-line bg-canvas px-2.5 text-sm text-ink outline-none transition focus:border-accent"
            disabled={busy}
            inputMode="decimal"
            onChange={(event) => setThreshold(event.target.value)}
            value={threshold}
          />
        </label>
      ) : null}
      {result && !result.ok ? <p className="mt-2 text-[0.8125rem] text-red-600">{result.message}</p> : null}
      <div className="mt-3 flex gap-2">
        <Button
          onClick={() => {
            setResult(null);
            onDone();
          }}
          size="sm"
          variant="secondary"
        >
          Cancel
        </Button>
        <Button
          disabled={busy || (hasThreshold && (parsedThreshold === null || !Number.isFinite(parsedThreshold)))}
          onClick={() => void confirm()}
          size="sm"
          variant={action.type === "disable_alert" ? "danger" : "primary"}
        >
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : action.type === "disable_alert" ? (
            "Turn off"
          ) : (
            "Set alert"
          )}
        </Button>
      </div>
    </div>
  );
}

function SyncActionCard({ onDone }: { onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);

  async function confirm() {
    if (busy) return;
    setBusy(true);
    const outcome = await postAction({ type: "sync" });
    setBusy(false);
    setResult(outcome.ok ? { ok: true, message: "Data refreshed." } : outcome);
  }

  if (result?.ok) {
    return <ActionResultBanner result={result} />;
  }

  return (
    <div className="rounded-md border border-line bg-paper p-3">
      <p className="text-sm font-medium text-ink">Refresh data</p>
      <p className="mt-0.5 text-xs text-muted">Sync the latest usage and balance from LiveMopay now.</p>
      {result && !result.ok ? <p className="mt-2 text-[0.8125rem] text-red-600">{result.message}</p> : null}
      <div className="mt-3 flex gap-2">
        <Button
          onClick={() => {
            setResult(null);
            onDone();
          }}
          size="sm"
          variant="secondary"
        >
          Cancel
        </Button>
        <Button disabled={busy} onClick={() => void confirm()} size="sm" variant="primary">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Sync now"}
        </Button>
      </div>
    </div>
  );
}

function ActionButton({ action }: { action: AssistantAction }) {
  const router = useRouter();
  const { isActivitiesEnabled, isAlertsEnabled, isDemo } = useAssistant();
  const [expanded, setExpanded] = useState(false);

  if (action.type === "navigate") {
    return (
      <Button
        onClick={() => router.push(resolveAssistantDestination(action.destination))}
        size="sm"
        variant="secondary"
      >
        {action.label}
      </Button>
    );
  }

  if (action.type === "add_activity" && !isActivitiesEnabled) return null;
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
    if (action.type === "sync") return <SyncActionCard onDone={() => setExpanded(false)} />;
    return <AlertActionCard action={action} onDone={() => setExpanded(false)} />;
  }

  return (
    <Button
      onClick={() => setExpanded(true)}
      size="sm"
      variant={action.type === "disable_alert" ? "secondary" : "primary"}
    >
      {action.label}
    </Button>
  );
}

export function AssistantActionRow({ actions }: { actions: AssistantAction[] }) {
  const { isDemo } = useAssistant();
  if (actions.length === 0) {
    return null;
  }

  const hasMutationActions = actions.some((action) => action.type !== "navigate");

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
