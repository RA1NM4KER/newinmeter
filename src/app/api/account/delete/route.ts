import { NextResponse } from "next/server";
import { getAuthenticatedSession } from "@/lib/auth/session";
import { DemoAccountProtectedError, deleteAccountForUser } from "@/lib/newinmeter/connection";
import { createServerSupabaseClient } from "@/lib/supabase/server-client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  const session = await getAuthenticatedSession();
  if (!session) {
    return NextResponse.json({ message: "Authentication required." }, { status: 401 });
  }

  try {
    await deleteAccountForUser(session.userId);
  } catch (error) {
    if (error instanceof DemoAccountProtectedError) {
      return NextResponse.json(
        { message: "This is a shared demo account and cannot be deleted.", demoAccount: true },
        { status: 403 }
      );
    }
    throw error;
  }

  const supabase = createServerSupabaseClient();
  await supabase.auth.signOut();

  return NextResponse.json({ status: "deleted" });
}
