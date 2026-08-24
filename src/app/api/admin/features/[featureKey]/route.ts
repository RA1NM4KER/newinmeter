import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminSession } from "@/lib/auth/session";
import { setRolloutMode } from "@/lib/features";
import { isFeatureKey, ROLLOUT_MODES } from "@/lib/newinmeter/features-shared";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodySchema = z.object({
  rolloutMode: z.enum(ROLLOUT_MODES)
});

export async function PATCH(request: Request, { params }: { params: { featureKey: string } }) {
  const auth = await requireAdminSession();
  if (!auth.ok) {
    return NextResponse.json(
      { message: auth.status === 401 ? "Authentication required." : "Admin access required." },
      { status: auth.status }
    );
  }

  if (!isFeatureKey(params.featureKey)) {
    return NextResponse.json({ message: "Unknown feature." }, { status: 404 });
  }

  const { rolloutMode } = bodySchema.parse(await request.json());
  await setRolloutMode(params.featureKey, rolloutMode);

  return NextResponse.json({ status: "updated" });
}
