"use client";

import { useState, type FormEvent } from "react";
import { ArrowRight, CheckCircle2, Loader2, Mail } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser-client";

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
      // other verified sign-in.
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
    <div className="mt-1 flex flex-col items-center gap-1.5 border-t border-white/10 pt-4">
      <button
        type="button"
        onClick={() => void handleClick()}
        disabled={isSubmitting}
        className="inline-flex h-11 items-center justify-center gap-2 rounded-full border border-brandGreen/30 bg-brandGreen/10 px-5 text-sm font-medium text-brandGreen transition hover:bg-brandGreen/15 disabled:cursor-not-allowed disabled:opacity-70"
      >
        {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
        Explore demo account
      </button>
      <p className="text-xs text-white/35">View NewinMeter with synthetic data</p>
      {error ? <p className="text-sm text-red-400">{error}</p> : null}
    </div>
  );
}

export function LoginForm({ demoToken }: { demoToken?: string }) {
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      const supabase = createSupabaseBrowserClient();
      const { error: signInError } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`
        }
      });

      if (signInError) {
        setError(signInError.message);
        return;
      }

      setSent(true);
    } finally {
      setIsSubmitting(false);
    }
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

  if (sent) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] px-6 py-6 text-center">
        <CheckCircle2 className="h-5 w-5 text-brandGreen" aria-hidden="true" />
        <p className="text-sm text-white">
          Sent to <span className="font-medium">{email}</span>
        </p>
        <p className="text-xs text-white/45">Open the link on this device to continue.</p>
        <button
          type="button"
          onClick={() => setSent(false)}
          className="mt-1 text-xs font-medium text-brandGreen transition hover:opacity-80"
        >
          Use a different email
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={() => void handleGoogleSignIn()}
        disabled={isGoogleLoading}
        className="inline-flex h-12 items-center justify-center gap-2 rounded-full border border-white/15 bg-white text-sm font-medium text-neutral-900 transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-70"
      >
        {isGoogleLoading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <GoogleIcon />}
        Continue with Google
      </button>

      <div className="my-1 flex items-center gap-3">
        <div className="h-px flex-1 bg-white/10" />
        <span className="text-xs text-white/35">or</span>
        <div className="h-px flex-1 bg-white/10" />
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <div className="relative">
          <Mail
            aria-hidden="true"
            className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35"
          />
          <input
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            className="h-12 w-full rounded-full border border-white/10 bg-white/[0.04] pl-11 pr-4 text-sm text-white outline-none transition placeholder:text-white/30 focus:border-brandGreen"
          />
        </div>

        {error ? <p className="text-sm text-red-400">{error}</p> : null}

        <button
          type="submit"
          disabled={isSubmitting || !email}
          className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-brandGreen text-sm font-semibold text-neutral-950 transition hover:brightness-95 disabled:cursor-not-allowed"
        >
          {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
          Send sign-in link
          {!isSubmitting ? <ArrowRight className="h-4 w-4" aria-hidden="true" /> : null}
        </button>

        <p className="mt-1 text-xs text-white/35">One-time link, no password to remember.</p>
      </form>

      {demoToken ? <DemoLoginButton token={demoToken} /> : null}
    </div>
  );
}
