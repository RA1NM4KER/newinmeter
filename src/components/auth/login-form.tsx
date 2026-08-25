"use client";

import { useEffect, useState, type FormEvent } from "react";
import { ArrowRight, CheckCircle2, Loader2, Mail } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser-client";

const OTP_LENGTH = 6;
// Long enough to discourage spamming Supabase's own send endpoint, short
// enough that a user who genuinely didn't get the email isn't stuck
// waiting. Supabase's own auth rate limits are the real backstop here --
// this is purely a client-side "don't be annoying" guard, not security.
const RESEND_COOLDOWN_SECONDS = 45;

function GoogleIcon() {
  return (
    <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 48 48">
      <path
        fill="#FFC107"
        d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"
      />
      <path
        fill="#FF3D00"
        d="m6.306 14.691 6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238A11.91 11.91 0 0 1 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 0 1-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"
      />
    </svg>
  );
}

// Only rendered when the server-validated `demo` query token was present and
// correct (see src/app/login/page.tsx and src/lib/demo/access-token.ts) --
// this component itself never checks or knows the expected token, it just
// holds the already-validated one in memory long enough to POST it once. The
// login-form parent doesn't render this at all for a missing/invalid token,
// so an ordinary visitor sees nothing different about the page.
function DemoLoginButton({ token }: { token: string }) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleClick() {
    setError("");
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/demo-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token })
      });

      const body = await response.json().catch(() => null);

      if (!response.ok || !body?.tokenHash) {
        setError(body?.message || "Could not start the demo. Please try again.");
        setIsSubmitting(false);
        return;
      }

      // Redeems the server-generated magic link with the same anon-key
      // browser client every other sign-in path uses -- this is Supabase's
      // own supported way to consume a link generated out-of-band (the
      // action_link itself only works when opened by the same browser that
      // requested it, which isn't the case for a server-admin-generated
      // link). A normal Supabase session comes out of this, same as any
      // other verified sign-in. Distinct from the email OTP flow below --
      // this redeems a server-generated `token_hash` via type "magiclink",
      // not a user-typed 6-digit code via type "email".
      const supabase = createSupabaseBrowserClient();
      const { error: verifyError } = await supabase.auth.verifyOtp({
        token_hash: body.tokenHash,
        type: "magiclink"
      });

      if (verifyError) {
        setError("Could not start the demo. Please try again.");
        setIsSubmitting(false);
        return;
      }

      window.location.href = "/";
    } catch {
      setError("Could not start the demo. Please try again.");
      setIsSubmitting(false);
    }
  }

  return (
    <div className="mt-1 flex flex-col items-start gap-1.5 border-t border-line pt-4">
      <button
        type="button"
        onClick={() => void handleClick()}
        disabled={isSubmitting}
        className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-brandTeal/25 bg-accentSoft px-4 text-sm font-medium text-brandTeal outline-none transition hover:border-brandTeal/40 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70"
      >
        {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
        Explore demo account
      </button>
      <p className="text-xs text-muted">View NewinMeter with synthetic data</p>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
    </div>
  );
}

// Best-effort classification of a verifyOtp failure into copy the user can
// actually act on. Supabase doesn't reliably expose a clean "expired" vs
// "wrong code" signal across versions -- `code` is checked first where
// present (newer supabase-js), falling back to matching the message text,
// and anything unrecognized gets the honest generic fallback rather than a
// guess dressed up as certainty.
function describeVerifyOtpError(error: { message?: string; code?: string } | null | undefined): string {
  const code = error?.code ?? "";
  const message = (error?.message ?? "").toLowerCase();

  if (code === "otp_expired" || message.includes("expired")) {
    return "That code has expired. Send a new one and try again.";
  }
  if (code === "otp_disabled" || message.includes("invalid") || message.includes("token")) {
    return "That code isn't correct. Check the email and try again.";
  }
  return "That code couldn't be verified. Try again or send a new code.";
}

export function LoginForm({ demoToken }: { demoToken?: string }) {
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [error, setError] = useState("");
  const [resendMessage, setResendMessage] = useState("");
  const [cooldownRemaining, setCooldownRemaining] = useState(0);

  // Single ticking interval for the whole code step -- runs whenever this
  // step is active and just no-ops once cooldownRemaining is already 0,
  // rather than restarting itself every time the count changes.
  useEffect(() => {
    if (step !== "code") {
      return;
    }
    const id = setInterval(() => {
      setCooldownRemaining((previous) => (previous > 0 ? previous - 1 : 0));
    }, 1000);
    return () => clearInterval(id);
  }, [step]);

  async function sendCode(): Promise<boolean> {
    const supabase = createSupabaseBrowserClient();
    // No emailRedirectTo: this is a code the user types back in here, not a
    // link to follow -- nothing for Supabase to redirect to. Omitting it
    // also means the Magic Link route in the email template (if the
    // Dashboard template isn't already switched to OTP-only) has nowhere
    // useful to send the user, encouraging use of the code instead.
    const { error: signInError } = await supabase.auth.signInWithOtp({ email });

    if (signInError) {
      setError(signInError.message);
      return false;
    }

    return true;
  }

  async function handleSubmitEmail(event: FormEvent) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      const ok = await sendCode();
      if (ok) {
        setCode("");
        setResendMessage("");
        setCooldownRemaining(RESEND_COOLDOWN_SECONDS);
        setStep("code");
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleResend() {
    if (isResending || cooldownRemaining > 0) {
      return;
    }
    setError("");
    setResendMessage("");
    setIsResending(true);

    try {
      const ok = await sendCode();
      if (ok) {
        setCode("");
        setResendMessage("New code sent.");
        setCooldownRemaining(RESEND_COOLDOWN_SECONDS);
      }
    } finally {
      setIsResending(false);
    }
  }

  async function verifyCode(candidate: string) {
    if (isVerifying || candidate.length !== OTP_LENGTH) {
      return;
    }
    setError("");
    setResendMessage("");
    setIsVerifying(true);

    try {
      const supabase = createSupabaseBrowserClient();
      const { error: verifyError } = await supabase.auth.verifyOtp({
        email,
        token: candidate,
        type: "email"
      });

      if (verifyError) {
        setError(describeVerifyOtpError(verifyError));
        setCode("");
        setIsVerifying(false);
        return;
      }

      // Session is created by this same call, inside this same page/PWA
      // context -- no redirect through /auth/callback, so there's no
      // browser hand-off for an installed PWA to get stranded by.
      window.location.href = "/";
    } catch {
      setError("Couldn't verify the code. Check your connection and try again.");
      setIsVerifying(false);
    }
  }

  // Auto-submits once six digits are present (typed, pasted, or
  // autofilled) -- verifyCode's own isVerifying guard keeps this from
  // double-firing, and a failed attempt clears `code`, so this naturally
  // doesn't re-trigger until the user has entered a fresh 6-digit value.
  useEffect(() => {
    if (code.length === OTP_LENGTH) {
      void verifyCode(code);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  function handleSubmitCode(event: FormEvent) {
    event.preventDefault();
    void verifyCode(code);
  }

  function handleUseDifferentEmail() {
    setStep("email");
    setCode("");
    setError("");
    setResendMessage("");
    setCooldownRemaining(0);
  }

  async function handleGoogleSignIn() {
    setError("");
    setIsGoogleLoading(true);

    const supabase = createSupabaseBrowserClient();
    const { error: signInError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`
      }
    });

    if (signInError) {
      setError(signInError.message);
      setIsGoogleLoading(false);
    }
  }

  if (step === "code") {
    return (
      <div className="flex flex-col items-center gap-3 border-t border-line py-5 text-center">
        <CheckCircle2 className="h-5 w-5 text-accent" aria-hidden="true" />
        <div>
          <p className="text-sm font-medium text-ink">Check your email</p>
          <p className="mt-1 text-xs text-muted">
            We sent a 6-digit sign-in code to <span className="font-medium text-ink">{email}</span>
          </p>
        </div>

        <form onSubmit={handleSubmitCode} className="mt-2 flex w-full flex-col items-center gap-3">
          <input
            aria-label="6-digit code"
            autoComplete="one-time-code"
            autoFocus
            className="h-14 w-48 rounded-lg border border-line bg-paper text-center text-2xl font-semibold tracking-[0.5em] text-ink outline-none transition focus:border-brandTeal focus:ring-2 focus:ring-accent/30"
            disabled={isVerifying}
            inputMode="numeric"
            maxLength={OTP_LENGTH}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, OTP_LENGTH))}
            pattern="[0-9]*"
            placeholder="······"
            value={code}
          />

          <p className="text-xs text-muted">Enter the code from your email to continue.</p>

          {error ? <p className="text-sm text-red-700">{error}</p> : null}
          {!error && resendMessage ? <p className="text-sm text-success">{resendMessage}</p> : null}

          <button
            type="submit"
            disabled={isVerifying || code.length !== OTP_LENGTH}
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-brandTeal text-sm font-semibold text-white outline-none transition hover:brightness-110 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {isVerifying ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            Continue
          </button>
        </form>

        <div className="mt-1 flex items-center gap-3">
          <button
            type="button"
            onClick={() => void handleResend()}
            disabled={isResending || cooldownRemaining > 0}
            className="rounded text-xs font-medium text-brandTeal outline-none transition hover:text-ink focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:text-muted"
          >
            {cooldownRemaining > 0 ? `Resend code (${cooldownRemaining}s)` : "Resend code"}
          </button>
          <span className="text-xs text-line">·</span>
          <button
            type="button"
            onClick={handleUseDifferentEmail}
            className="rounded text-xs font-medium text-brandTeal outline-none transition hover:text-ink focus-visible:ring-2 focus-visible:ring-accent"
          >
            Use a different email
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={() => void handleGoogleSignIn()}
        disabled={isGoogleLoading}
        className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-ink/20 bg-paper text-sm font-medium text-ink outline-none transition hover:border-ink/40 hover:bg-canvas focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70"
      >
        {isGoogleLoading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <GoogleIcon />}
        Continue with Google
      </button>

      <div className="my-1 flex items-center gap-3">
        <div className="h-px flex-1 bg-line" />
        <span className="text-xs text-muted">or</span>
        <div className="h-px flex-1 bg-line" />
      </div>

      <form onSubmit={handleSubmitEmail} className="flex flex-col gap-3">
        <label htmlFor="login-email" className="text-xs font-medium text-ink">
          Email address
        </label>
        <div className="relative">
          <Mail
            aria-hidden="true"
            className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
          />
          <input
            id="login-email"
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            className="h-11 w-full rounded-lg border border-line bg-paper pl-10 pr-4 text-sm text-ink outline-none transition placeholder:text-muted/70 focus:border-brandTeal focus:ring-2 focus:ring-accent/30"
          />
        </div>

        {error ? <p className="text-sm text-red-700">{error}</p> : null}

        <button
          type="submit"
          disabled={isSubmitting || !email}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-brandTeal text-sm font-semibold text-white outline-none transition hover:brightness-110 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
          Send code
          {!isSubmitting ? <ArrowRight className="h-4 w-4" aria-hidden="true" /> : null}
        </button>

        <p className="mt-1 text-xs text-muted">We&apos;ll email you a 6-digit code. No password to remember.</p>
      </form>

      {demoToken ? <DemoLoginButton token={demoToken} /> : null}
    </div>
  );
}
