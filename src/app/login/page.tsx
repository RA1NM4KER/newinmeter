import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { LoginForm } from "@/components/auth/login-form";
import { getAuthenticatedSession } from "@/lib/auth/session";
import { isValidDemoAccessToken } from "@/lib/demo/access-token";
import { recordFunnelEvent } from "@/lib/funnel";

export const metadata = {
  title: "NewinMeter | Your electricity, finally explained",
  description: "Understand prepaid electricity usage and get useful alerts. Free for Newinbosch residents."
};

export const dynamic = "force-dynamic";

type LoginPageProps = {
  searchParams?: { demo?: string };
};

// Previously middleware's job (redirect an already-authenticated visitor
// straight past /login) -- moved here now that middleware no longer makes
// any routing/authorization decision (see src/middleware.ts). Checked first,
// before anything else on this page, so a signed-in visitor never sees a
// flash of the login form.
export default async function LoginPage({ searchParams }: LoginPageProps) {
  const session = await getAuthenticatedSession();
  if (session) {
    redirect("/");
  }

  const suppliedToken = searchParams?.demo;
  const demoToken = isValidDemoAccessToken(suppliedToken) ? suppliedToken : undefined;

  // Only tracked once we know we're actually rendering the login page for a
  // genuinely unauthenticated visitor -- an already-signed-in visit above
  // redirects before this line, so it never inflates the funnel metric.
  await recordFunnelEvent("login_page_viewed");

  return (
    <AuthShell
      title={
        <>
          Your electricity.
          <br />
          <span className="text-brandTeal">Finally explained.</span>
        </>
      }
      description="A free tool built by a Newinbosch resident to make LiveMopay's electricity data actually make sense. Have a look, or connect your own."
    >
      <LoginForm demoToken={demoToken} />
    </AuthShell>
  );
}
