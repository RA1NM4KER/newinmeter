"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, ChevronRight, HelpCircle, Loader2, Lock, Mail, ShieldCheck, Zap } from "lucide-react";
import { trackFunnelEvent } from "@/lib/funnel-client";

type AccountOption = { index: number; label: string };
type Step = "form" | "picker" | "syncing" | "sync-error";

type ConnectFormProps = {
  defaultEmail: string;
  initialPendingAccounts: AccountOption[] | null;
  livemopayPortalUrl: string;
};

export function ConnectForm({ defaultEmail, initialPendingAccounts, livemopayPortalUrl }: ConnectFormProps) {
  const router = useRouter();
  const [email, setEmail] = useState(defaultEmail);
  const [password, setPassword] = useState("");
  const [accounts, setAccounts] = useState<AccountOption[] | null>(initialPendingAccounts);
  const [accountLabel, setAccountLabel] = useState<string | null>(null);
  const [step, setStep] = useState<Step>(initialPendingAccounts ? "picker" : "form");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [invalidCredentials, setInvalidCredentials] = useState(false);

  // The whole point of connecting is to see a populated dashboard, not an
  // empty one -- so the first sync runs to completion, with the person
  // watching, before they ever land on "/".
  async function runInitialSync() {
    setStep("syncing");

    try {
      const response = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "full" })
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(body.message || "Could not fetch your LiveMopay history.");
        setStep("sync-error");
        trackFunnelEvent("initial_sync_failed");
        return;
      }

      trackFunnelEvent("initial_sync_succeeded");
      router.replace("/");
      router.refresh();
    } catch {
      setError("Could not fetch your LiveMopay history.");
      setStep("sync-error");
      trackFunnelEvent("initial_sync_failed");
    }
  }

  async function handleConnect(event: FormEvent) {
    event.preventDefault();
    setError("");
    setInvalidCredentials(false);
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/livemopay/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
      });
      const body = await response.json();

      // Cleared immediately either way -- never held onto waiting on a
      // response.
      setPassword("");

      if (!response.ok) {
        setError(body.message || "Could not connect your LiveMopay account.");
        setInvalidCredentials(Boolean(body.invalidCredentials));
        return;
      }

      if (body.status === "pending_selection") {
        setAccounts(body.accounts);
        setStep("picker");
        return;
      }

      setAccountLabel(body.accountLabel ?? null);
      await runInitialSync();
    } catch {
      setError("Could not connect your LiveMopay account.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSelectAccount(index: number) {
    setError("");
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/livemopay/select-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ index })
      });
      const body = await response.json();

      if (!response.ok) {
        setError(body.message || "Could not finish connecting your account.");
        return;
      }

      setAccountLabel(body.accountLabel ?? null);
      await runInitialSync();
    } catch {
      setError("Could not finish connecting your account.");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (step === "syncing") {
    return (
      <div className="flex flex-col items-center gap-4 rounded-2xl border border-line bg-paper px-6 py-10 text-center">
        <Loader2 className="h-6 w-6 animate-spin text-accent" aria-hidden="true" />
        <div>
          <h2 className="text-base font-semibold text-ink">Pulling in your history</h2>
          <p className="mt-1.5 max-w-xs text-sm leading-relaxed text-muted">
            Fetching every charge LiveMopay has on record{accountLabel ? ` for ${accountLabel}` : ""}. This takes a
            moment the first time.
          </p>
        </div>
      </div>
    );
  }

  if (step === "sync-error") {
    return (
      <div className="flex flex-col items-start gap-4 rounded-2xl border border-line bg-paper px-6 py-7 text-left">
        <AlertCircle className="h-5 w-5 text-red-700" aria-hidden="true" />
        <div>
          <h2 className="text-base font-semibold text-ink">Your account connected, but the first sync failed</h2>
          <p className="mt-1.5 text-sm leading-relaxed text-muted">{error}</p>
        </div>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => void runInitialSync()}
            className="inline-flex h-10 items-center rounded-lg bg-ink px-4 text-sm font-semibold text-paper transition hover:bg-brandTeal"
          >
            Try again
          </button>
          <button
            type="button"
            onClick={() => {
              router.replace("/");
              router.refresh();
            }}
            className="inline-flex h-10 items-center rounded-lg border border-line px-4 text-sm font-medium text-muted transition hover:text-ink"
          >
            Skip for now
          </button>
        </div>
      </div>
    );
  }

  if (step === "picker") {
    return (
      <div className="rounded-2xl border border-line bg-paper px-6 py-7 text-left">
        <Zap className="h-5 w-5 text-accent" aria-hidden="true" />
        <h2 className="mt-3 text-base font-semibold text-ink">Choose your account</h2>
        <p className="mt-1.5 text-sm leading-relaxed text-muted">
          LiveMopay returned more than one account for this login. Pick the one you want to track.
        </p>

        <div className="mt-5 flex flex-col gap-2">
          {(accounts ?? []).map((account) => (
            <button
              key={account.index}
              type="button"
              disabled={isSubmitting}
              onClick={() => void handleSelectAccount(account.index)}
              className="group flex items-center justify-between rounded-xl border border-line bg-canvas px-4 py-3 text-left text-sm text-ink transition hover:border-brandTeal/50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {account.label}
              <ChevronRight
                aria-hidden="true"
                className="h-4 w-4 text-muted transition group-hover:translate-x-0.5 group-hover:text-brandTeal"
              />
            </button>
          ))}
        </div>

        {error ? <p className="mt-4 text-sm text-red-700">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-line bg-paper px-6 py-7 text-left">
      <Zap className="h-5 w-5 text-accent" aria-hidden="true" />
      <h2 className="mt-3 text-base font-semibold text-ink">Log in with your LiveMopay details</h2>
      <p className="mt-1.5 text-sm leading-relaxed text-muted">
        The same email and password you already use for LiveMopay -- not a new account, and often a different email
        than the one you used to sign in here.
      </p>

      <form onSubmit={handleConnect} className="mt-5 flex flex-col gap-3">
        <div className="relative">
          <Mail
            aria-hidden="true"
            className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
          />
          <input
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="LiveMopay email"
            className={`h-12 w-full rounded-full border bg-canvas pl-11 pr-4 text-sm text-ink outline-none transition placeholder:text-muted/70 focus:border-brandTeal ${invalidCredentials ? "border-red-300" : "border-line"}`}
          />
        </div>
        <div className="relative">
          <Lock
            aria-hidden="true"
            className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
          />
          <input
            type="password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="LiveMopay password"
            className={`h-12 w-full rounded-full border bg-canvas pl-11 pr-4 text-sm text-ink outline-none transition placeholder:text-muted/70 focus:border-brandTeal ${invalidCredentials ? "border-red-300" : "border-line"}`}
          />
        </div>

        {error ? (
          <div className="rounded-xl bg-red-50 px-3 py-2.5 text-sm text-red-700">
            <p>{error}</p>
            {invalidCredentials ? (
              <a
                href={livemopayPortalUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-1 inline-flex items-center gap-1 text-xs font-medium underline underline-offset-2 hover:no-underline"
              >
                <HelpCircle aria-hidden="true" className="h-3 w-3" />
                Forgot your LiveMopay password? Reset it at the LiveMopay portal
              </a>
            ) : null}
          </div>
        ) : null}

        <button
          type="submit"
          disabled={isSubmitting}
          className="mt-2 inline-flex h-12 items-center justify-center gap-2 rounded-full bg-ink text-sm font-semibold text-paper transition hover:bg-brandTeal disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
          Connect
        </button>
      </form>

      <div className="mt-5 flex items-start gap-2 rounded-xl bg-canvas px-3 py-2.5 text-xs leading-relaxed text-muted">
        <ShieldCheck aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted" />
        <p>
          Your password is used once, right now, to fetch your electricity history -- then thrown away. NewinMeter
          never stores it, and you can disconnect any time from the dashboard header.
        </p>
      </div>
    </div>
  );
}
