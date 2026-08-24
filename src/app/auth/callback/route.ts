import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server-client";

// Google OAuth's redirect target only -- LoginForm's signInWithOAuth points
// here (see redirectTo). Email sign-in no longer uses this route: it's a
// typed 6-digit code verified via supabase.auth.verifyOtp() directly inside
// the page that requested it (see login-form.tsx), not a link that redirects
// through a `code` exchange. Do not delete this route on the assumption
// email login made it obsolete -- Google OAuth still depends on it.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  if (code) {
    const supabase = createServerSupabaseClient();
    await supabase.auth.exchangeCodeForSession(code);
  }

  return NextResponse.redirect(`${origin}${next}`);
}
