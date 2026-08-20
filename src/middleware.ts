import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { getSupabasePublicConfig } from "@/lib/supabase/public-config";

const PUBLIC_PATHS = ["/login", "/auth/callback", "/auth/sign-out", "/privacy", "/terms", "/install", "/splash"];

// Session refresh + gate for unauthenticated access. The connection-required
// redirect (authenticated but not yet connected -> /connect) lives in the
// page components instead, since it needs a service-role read that shouldn't
// run in Edge middleware.
export async function middleware(request: NextRequest) {
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

  // getClaims() verifies the JWT signature locally (via a cached JWKS) once
  // the project is on asymmetric signing keys, instead of getUser()'s
  // unconditional round trip to the Auth server -- this runs on every
  // navigation, so that's the difference between one network hop and zero.
  // On projects still using symmetric (HS256) keys it transparently falls
  // back to calling getUser() itself, so this is safe before and after that
  // migration (see supabase.com/docs/guides/auth/signing-keys).
  const { data: claimsData } = await supabase.auth.getClaims();
  const user = claimsData?.claims ?? null;

  const pathname = request.nextUrl.pathname;
  const isPublicPath = PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
  const isApiPath = pathname.startsWith("/api/");

  if (!user && !isPublicPath && !isApiPath) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (user && pathname === "/login") {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return response;
}

export const config = {
  matcher: [
    // Excludes _next internals and any request for a static file extension
    // (png/svg/etc, manifest, service worker) instead of naming each public/
    // asset individually -- a forgotten filename here means the asset gets
    // redirected to /login instead of served, exactly as dashboard-preview.png
    // did before this was broadened.
    "/((?!_next/static|_next/image|favicon.ico|icon|apple-icon|manifest.webmanifest|sw.js|.*\\.(?:png|jpg|jpeg|svg|gif|webp|ico|woff2?)$).*)"
  ]
};
