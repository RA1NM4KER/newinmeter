import { NextResponse } from "next/server";
import { z } from "zod";
import { isValidDemoAccessToken } from "@/lib/demo/access-token";
import { getNewinmeterDemoEmail } from "@/lib/env";
import { getConnectionForUser } from "@/lib/newinmeter/connection";
import { enforceRateLimit, getRateLimitIdentifier, getTrustedRequestIp, rateLimitHeaders } from "@/lib/rate-limit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin-client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const demoLoginSchema = z.object({ token: z.string().min(1).max(512) });

// Every failure path returns this exact body -- missing token, wrong token,
// unconfigured feature, misconfigured demo user, or an upstream Supabase
// error all look identical to the caller. Distinguishing any of them would
// let a caller learn something about NEWINMETER_DEMO_ACCESS_TOKEN or whether
// a demo account exists at all.
function denied(headers: HeadersInit) {
  return NextResponse.json({ message: "Invalid or missing demo access." }, { status: 401, headers });
}

// One-click recruiter demo sign-in. Never accepts an email/target user from
// the request -- the only account this can ever sign in is
// NEWINMETER_DEMO_EMAIL, read from server env. Flow:
//   1. rate limit by IP (unauthenticated endpoint)
//   2. constant-time validate the supplied token against
//      NEWINMETER_DEMO_ACCESS_TOKEN
//   3. look up the existing demo user by email (never create one here --
//      generateLink() can silently create a user for type "magiclink", which
//      must never happen from this endpoint)
//   4. confirm that user's connection is actually marked is_demo (defense in
//      depth against NEWINMETER_DEMO_EMAIL being misconfigured to a real
//      user's address)
//   5. generate a real Supabase magic link server-side and hand back its
//      hashed_token. The client then calls supabase.auth.verifyOtp({
//      token_hash, type: "magiclink" }) with the normal anon-key browser
//      client -- the same client every other sign-in path already uses --
//      which is Supabase's own supported way to redeem a server-generated
//      link. (The link's action_link/PKCE `code` route only works when the
//      *same browser* that called signInWithOtp opens it, because PKCE needs
//      a code_verifier that only that browser has; an admin-generated link
//      has no such browser, so Supabase returns bearer tokens in a URL
//      fragment instead -- which never reaches a server. verifyOtp is the
//      mechanism Supabase documents for exactly this server-generated-link
//      case, and it produces a completely normal session via the ordinary
//      client, not a bespoke one.)
export async function POST(request: Request) {
  const identifier = getRateLimitIdentifier(getTrustedRequestIp(request), "demo-login");
  const rateLimit = await enforceRateLimit(identifier, "demoLogin");
  const rateHeaders = rateLimitHeaders(rateLimit);

  if (!rateLimit.allowed) {
    return NextResponse.json({ message: "Too many attempts. Try again later." }, { status: 429, headers: rateHeaders });
  }

  const parsed = demoLoginSchema.safeParse(await request.json().catch(() => null));

  if (!parsed.success || !isValidDemoAccessToken(parsed.data.token)) {
    return denied(rateHeaders);
  }

  const demoEmail = getNewinmeterDemoEmail();
  if (!demoEmail) {
    return denied(rateHeaders);
  }

  const admin = createSupabaseAdminClient();
  const { data: userList, error: listError } = await admin.auth.admin.listUsers({ perPage: 1000 });

  if (listError) {
    console.error("demo_login_failed", "could not list auth users");
    return denied(rateHeaders);
  }

  const demoUser = userList.users.find((user) => user.email?.toLowerCase() === demoEmail.toLowerCase());

  if (!demoUser) {
    console.error("demo_login_failed", "configured demo user does not exist -- run scripts/seed-demo-account.ts");
    return denied(rateHeaders);
  }

  const connection = await getConnectionForUser(demoUser.id);
  if (!connection?.isDemo) {
    console.error("demo_login_failed", "configured demo email is not an is_demo connection -- refusing to sign in");
    return denied(rateHeaders);
  }

  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: demoEmail
  });

  if (linkError || !linkData?.properties?.hashed_token) {
    console.error("demo_login_failed", linkError?.message ?? "generateLink returned no hashed_token");
    return denied(rateHeaders);
  }

  return NextResponse.json({ tokenHash: linkData.properties.hashed_token }, { headers: rateHeaders });
}
