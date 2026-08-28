import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { getSupabasePublicConfig } from "@/lib/supabase/public-config";

const PUBLIC_PATHS = [
  "/login",
  "/auth/callback",
  "/auth/sign-out",
  "/privacy",
  "/terms",
  "/install",
  "/splash",
  // Static PWA fallback shown by the service worker when navigation fails
  // offline -- must never depend on reaching Supabase, since "offline" is
  // precisely when a network call to it would be least likely to succeed.
  "/offline"
];

// Bounds the one Supabase call middleware still makes (see below). Generous
// for a real-but-slow refresh, tiny next to Vercel's 25s hard Edge
// middleware cutoff -- the point is that a stalled/unreachable Supabase Auth
// endpoint degrades to "this request's opportunistic cookie refresh got
// skipped", never to "the whole site 504s". This is the one timeout wrapper
// in this file, and it deliberately never gates authorization -- it only
// bounds a best-effort side effect. See the module comment below for why
// that split is the actual fix, not a workaround.
const SESSION_REFRESH_TIMEOUT_MS = 4000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | "timeout"> {
  return Promise.race([promise, new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), ms))]);
}

// Middleware's ONLY remaining job is opportunistically refreshing the
// Supabase session cookie -- @supabase/ssr's own docs require this
// specifically because Server Components cannot persist cookies during
// render (see src/lib/supabase/server-client.ts's setAll, a documented
// no-op-in-catch there): without a middleware refresh, a rotated refresh
// token computed mid-render would never reach the browser, and the next
// request would replay the now-invalidated one -- a silent, hard-to-debug
// logout. Route Handlers (every API route) are NOT affected by that
// restriction and already refresh+persist their own session correctly via
// getAuthenticatedSession(), so API paths are skipped below.
//
// Middleware NEVER decides whether a route is allowed. That decision lives
// entirely in the Server Components that already made it independently of
// middleware: src/app/(app)/layout.tsx (every route under (app) -- "/",
// /admin, /admin/features, /admin/engagement, /settings, /live,
// /activities, /data), src/app/(app)/admin/layout.tsx (requireAdminSession),
// src/app/connect/page.tsx, and src/app/login/page.tsx (redirects an
// already-authenticated visitor away). Each of those runs in the Node.js
// runtime with a normal function timeout and Next.js's own error handling,
// not Vercel's unforgiving 25s Edge middleware cutoff.
//
// That split -- refresh here, authorize there -- is the actual fix for the
// MIDDLEWARE_INVOCATION_TIMEOUT/504s this app was hitting. Previously a
// stalled Supabase/JWKS call sat on the critical path for every protected
// navigation's routing decision, at the one layer with a hard platform kill
// switch and no per-route budget. Now the worst case here is a missed
// opportunistic refresh (logged, bounded, never blocking), and the actual
// authorization check runs where a stall just means a slow response, not an
// outage.
export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const isPublicPath = PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
  const isApiPath = pathname.startsWith("/api/");

  // Checked first, before any Supabase work: public pages render the same
  // for everyone, and every API route already authenticates itself. This is
  // also what keeps the vast majority of requests off any Supabase call at
  // all, not just off the protected-route ones.
  if (isPublicPath || isApiPath) {
    return NextResponse.next();
  }

  let response = NextResponse.next({ request });
  const { url, anonKey } = getSupabasePublicConfig();

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      }
    }
  });

  try {
    const result = await withTimeout(supabase.auth.getClaims(), SESSION_REFRESH_TIMEOUT_MS);
    if (result === "timeout") {
      // Upstream-slowness signal, distinct from a validation failure below --
      // never includes token/cookie/claim contents.
      console.warn("middleware_session_refresh_timeout", { pathname });
    }
  } catch (error) {
    // A failed refresh is not a routing decision -- the destination
    // page/layout resolves the session itself and redirects to /login if
    // it's genuinely gone. Logged only as an upstream-failure signal.
    console.warn("middleware_session_refresh_failed", {
      pathname,
      message: error instanceof Error ? error.message : "unknown_error"
    });
  }

  return response;
}

export const config = {
  matcher: [
    // Excludes _next internals and any request for a static file extension
    // (png/svg/etc, manifest, service worker) instead of naming each public/
    // asset individually -- a forgotten filename here means the asset gets
    // routed through middleware instead of served, exactly as
    // dashboard-preview.png did before this was broadened.
    "/((?!_next/static|_next/image|favicon.ico|icon|apple-icon|manifest.webmanifest|sw.js|.*\\.(?:png|jpg|jpeg|svg|gif|webp|ico|woff2?)$).*)"
  ]
};
