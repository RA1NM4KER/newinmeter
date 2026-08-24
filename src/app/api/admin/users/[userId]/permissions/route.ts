import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminSession } from "@/lib/auth/session";
import { setUserFeatureOverride } from "@/lib/features";
import { FEATURE_KEYS } from "@/lib/newinmeter/features-shared";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Every value here is an explicit per-user override -- toggling a feature
// for a user in the admin UI is always a deliberate decision, never an
// attempt to "revert to inherited". Writing succeeds regardless of the
// feature's current rollout mode (including "off"): the override is stored
// and takes effect the moment the feature returns to "everyone"/"selected".
const bodySchema = z
  .object({
    ai: z.boolean().optional(),
    activities: z.boolean().optional(),
    live: z.boolean().optional(),
    alerts: z.boolean().optional()
  })
  .refine((body) => FEATURE_KEYS.some((key) => body[key] !== undefined), {
    message: "Provide at least one feature to update."
  });

export async function PATCH(request: Request, { params }: { params: { userId: string } }) {
  const auth = await requireAdminSession();
  if (!auth.ok) {
    return NextResponse.json(
      { message: auth.status === 401 ? "Authentication required." : "Admin access required." },
      { status: auth.status }
    );
  }

  const body = bodySchema.parse(await request.json());

  for (const key of FEATURE_KEYS) {
    const value = body[key];
    if (value !== undefined) {
      await setUserFeatureOverride(params.userId, key, value);
    }
  }

  return NextResponse.json({ status: "updated" });
}
