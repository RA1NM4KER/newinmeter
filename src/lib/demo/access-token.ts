import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";
import { getNewinmeterDemoAccessToken } from "@/lib/env";

function digest(value: string) {
  return createHash("sha256").update(value, "utf8").digest();
}

// Constant-time check of a supplied `?demo=` token against
// NEWINMETER_DEMO_ACCESS_TOKEN. Hashing first means both operands are always
// exactly 32 bytes, so timingSafeEqual never short-circuits on length --
// which would otherwise leak how many leading characters of a guess were
// correct. Returns false (never throws) when the feature isn't configured or
// no token was supplied: callers must render/respond identically for "not
// configured" and "wrong token" so neither the login page nor the API route
// ever reveals that a demo account exists.
export function isValidDemoAccessToken(candidate: string | undefined | null): boolean {
  const expected = getNewinmeterDemoAccessToken();

  if (!expected || !candidate) {
    return false;
  }

  return timingSafeEqual(digest(candidate), digest(expected));
}
