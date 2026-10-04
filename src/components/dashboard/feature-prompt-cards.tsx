"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Activity, Sparkles, TrendingUp, Wallet, X, Zap } from "lucide-react";
import { useAssistant } from "@/components/assistant/assistant-provider";
import { formatCurrency, formatKwh } from "@/lib/format";
import { DEFAULT_THRESHOLDS } from "@/lib/newinmeter/alert-types";
import {
  dismissPrompt,
  isWelcomeBackDue,
  latestCompleteDay,
  pickDashboardPrompt,
  readDismissedPrompts,
  readLastVisitAt,
  summariseSinceVisit,
  writeLastVisitAt,
  type DashboardPrompt,
  type FeatureAdoption,
  type FeatureKey,
  type FeatureRates,
  type PromptRule
} from "@/lib/dashboard-prompts";
import type { DailyRollupRow } from "@/lib/types";

// One prompt at a time. The pick is made once per day and weighted toward
// features few users have, so it does not change on refresh. Dismissing it
// lets the next eligible prompt take its place. Never a modal.
type DashboardPromptCardProps = {
  rules: PromptRule[];
  latestBalance: number | undefined;
  dailyRows: DailyRollupRow[];
  adoption: FeatureAdoption | null;
  rates: FeatureRates;
  dayKey: string;
  alertsAvailable: boolean;
  aiAvailable: boolean;
  activitiesAvailable: boolean;
  from: string;
  to: string;
  isDemo: boolean;
};

export function DashboardPromptCard({
  rules,
  latestBalance,
  dailyRows,
  adoption,
  rates,
  dayKey,
  alertsAvailable,
  aiAvailable,
  activitiesAvailable,
  from,
  to,
  isDemo
}: DashboardPromptCardProps) {
  const { open } = useAssistant();
  // Storage is read after mount so the server render and the first client
  // render match (both empty), same pattern as InstallPromoCard.
  const [dismissed, setDismissed] = useState<ReadonlySet<FeatureKey>>(new Set());
  useEffect(() => {
    setDismissed(readDismissedPrompts());
  }, []);

  if (isDemo) {
    return null;
  }

  const latestDay = latestCompleteDay(dailyRows);
  const prompt: DashboardPrompt | null = pickDashboardPrompt({
    rules,
    latestBalance,
    latestDay,
    dismissed,
    alertsAvailable,
    aiAvailable,
    activitiesAvailable,
    adoption,
    rates,
    dayKey
  });

  if (!prompt) {
    return null;
  }

  function handleDismiss(feature: FeatureKey) {
    dismissPrompt(feature);
    setDismissed((current) => new Set(current).add(feature));
  }

  const copy = promptCopy(prompt);
  const Icon = copy.icon;

  return (
    <section className="relative rounded-xl border border-line bg-paper px-4 py-3 shadow-soft">
      <div className="flex items-center gap-2.5 pr-6">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[0.5rem] border border-line bg-canvas text-ink/70">
          <Icon aria-hidden="true" size={16} strokeWidth={2} />
        </span>
        <p className="text-[0.9375rem] font-medium text-ink">{copy.title}</p>
      </div>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 flex-1 text-[0.8125rem] leading-snug text-muted">{copy.body}</p>
        {copy.action.kind === "link" ? (
          <Button variant="secondary" size="sm" href={copy.action.href} className="shrink-0">
            {copy.action.label}
          </Button>
        ) : (
          <Button variant="secondary" size="sm" onClick={() => open({ from, to })} className="shrink-0">
            {copy.action.label}
          </Button>
        )}
      </div>
      <button
        aria-label="Dismiss"
        className="absolute right-3 top-3 rounded-md p-1 text-muted transition hover:text-ink"
        onClick={() => handleDismiss(prompt.feature)}
        type="button"
      >
        <X aria-hidden="true" className="h-4 w-4" />
      </button>
    </section>
  );
}

type PromptAction = { kind: "link"; href: string; label: string } | { kind: "assistant"; label: string };

function promptCopy(prompt: DashboardPrompt): {
  icon: typeof Wallet;
  title: string;
  body: string;
  action: PromptAction;
} {
  const alertAction: PromptAction = { kind: "link", href: "/settings?tab=alerts", label: "Turn on alert" };

  if (prompt.feature === "alerts" && prompt.alert) {
    const { type, value, threshold, personal, periodDate } = prompt.alert;
    // Only say "your" when the user saved this threshold. Otherwise it is the
    // default they never chose, so "your" would be misleading.
    const limit = (amount: string, unit: string) =>
      personal ? `your ${amount} ${unit}` : `the suggested ${amount} level`;

    if (type === "low_balance") {
      return {
        icon: Wallet,
        title: "Want a heads-up before this happens?",
        body: `Your balance is ${formatCurrency(value)}, under ${limit(formatCurrency(threshold), "mark")}. Turn on a low balance alert and we will tell you before you run out.`,
        action: alertAction
      };
    }

    if (type === "daily_spend") {
      return {
        icon: TrendingUp,
        title: "That was a big spend day",
        body: `${periodDate ?? "The latest day"} cost ${formatCurrency(value)}, over ${limit(formatCurrency(threshold), "daily mark")}. Turn on a daily spend alert to hear about the next one.`,
        action: alertAction
      };
    }

    return {
      icon: Zap,
      title: "That was a heavy usage day",
      body: `${periodDate ?? "The latest day"} used ${formatKwh(value)}, over ${limit(formatKwh(threshold), "daily mark")}. Turn on a daily usage alert to hear about the next one.`,
      action: alertAction
    };
  }

  if (prompt.feature === "ai") {
    return {
      icon: Sparkles,
      title: "Ask your energy assistant",
      body: 'Ask in plain language, like "What did I spend last week?" or "When do I use the most power?"',
      action: { kind: "assistant", label: "Ask a question" }
    };
  }

  return {
    icon: Activity,
    title: "Explain your spikes",
    body: "Tag a day or time range with what happened, like a braai or a geyser day, so spikes make sense later.",
    action: { kind: "link", href: "/activities", label: "Add an activity" }
  };
}

type WelcomeBackCardProps = {
  dailyRows: DailyRollupRow[];
  isDemo: boolean;
};

// Shown once after 7+ days away. Summarises what changed since the last visit
// rather than promoting features. The timestamp is written on mount, so the
// card is shown at most once per absence.
export function WelcomeBackCard({ dailyRows, isDemo }: WelcomeBackCardProps) {
  const [summary, setSummary] = useState<{ spend: number; kwh: number; days: number; awayDays: number } | null>(null);
  // Captured on the first effect run. React strict mode runs mount effects
  // twice in dev, and the second run would otherwise read the timestamp the
  // first run just wrote and conclude there is nothing to summarise.
  const previousVisit = useRef<number | null | undefined>(undefined);
  const [dismissed, setDismissed] = useState(false);

  // Mount-only by design: re-running on every render would re-read a visit
  // timestamp this effect already overwrote. dailyRows does not change within
  // a page view, so it is intentionally not a dependency.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const now = Date.now();
    if (previousVisit.current === undefined) {
      previousVisit.current = readLastVisitAt();
    }
    const lastVisitAt = previousVisit.current;

    if (lastVisitAt !== null && isWelcomeBackDue(lastVisitAt, now)) {
      const { spend, kwh, days } = summariseSinceVisit(dailyRows, lastVisitAt);
      const awayDays = Math.floor((now - lastVisitAt) / (24 * 60 * 60 * 1000));
      setSummary({ spend, kwh, days, awayDays });
    }

    writeLastVisitAt(now);
    // Mount-only by design (see the comment above the effect).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (isDemo || !summary || summary.days === 0 || dismissed) {
    return null;
  }

  return (
    <section className="relative flex flex-col gap-3 rounded-xl border border-line bg-paper px-4 py-3 shadow-soft sm:flex-row sm:items-center sm:gap-5">
      <div className="min-w-0 sm:flex-1">
        <p className="text-[0.9375rem] font-medium text-ink">Welcome back</p>
        <p className="mt-0.5 text-[0.8125rem] leading-snug text-muted">
          Since your last visit {summary.awayDays} days ago
        </p>
      </div>
      <dl className="grid grid-cols-2 gap-2 sm:flex sm:shrink-0 sm:gap-3">
        <div className="rounded-lg border border-line bg-canvas px-3 py-1.5">
          <dt className="text-[0.75rem] text-muted">Spent</dt>
          <dd className="text-[0.9375rem] font-semibold text-ink">{formatCurrency(summary.spend)}</dd>
        </div>
        <div className="rounded-lg border border-line bg-canvas px-3 py-1.5">
          <dt className="text-[0.75rem] text-muted">Used</dt>
          <dd className="text-[0.9375rem] font-semibold text-ink">{formatKwh(summary.kwh)}</dd>
        </div>
      </dl>
      <button
        aria-label="Dismiss"
        className="absolute right-3 top-3 rounded-md p-1 text-muted transition hover:text-ink sm:static"
        onClick={() => setDismissed(true)}
        type="button"
      >
        <X aria-hidden="true" className="h-4 w-4" />
      </button>
    </section>
  );
}
