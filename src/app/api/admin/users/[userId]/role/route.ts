import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminSession } from "@/lib/auth/session";
import { setUserRole } from "@/lib/user-roles";
import { limitUserRequest } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodySchema = z.object({
  role: z.enum(["admin", "user"])
});

export async function PATCH(request: Request, { params }: { params: { userId: string } }) {
  const auth = await requireAdminSession();
  if (!auth.ok) {
    return NextResponse.json(
      { message: auth.status === 401 ? "Authentication required." : "Admin access required." },
      { status: auth.status }
    );
  }
  const rate = await limitUserRequest(auth.session.userId, "admin-user-role");
  if (rate.response) return rate.response;

  const { role } = bodySchema.parse(await request.json());

  if (params.userId === auth.session.userId && role !== "admin") {
    return NextResponse.json({ message: "You can't remove your own admin access." }, { status: 400 });
  }

  await setUserRole(params.userId, role);
  return NextResponse.json({ status: "updated" }, { headers: rate.headers });
}
