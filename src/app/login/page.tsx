import { AuthShell } from "@/components/auth/auth-shell";
import { LoginForm } from "@/components/auth/login-form";
import { isValidDemoAccessToken } from "@/lib/demo/access-token";

export const dynamic = "force-dynamic";

type LoginPageProps = {
  searchParams?: { demo?: string };
};

// The `demo` query param is validated server-side, here, before anything is
// rendered -- an invalid or missing token produces byte-identical output to
// a plain /login visit (no button, no hint a demo account exists). Only a
// server-confirmed-valid token is ever handed to the client component, and
// only so it can be replayed once to /api/demo-login, which re-validates it
// independently rather than trusting this render decision.
export default function LoginPage({ searchParams }: LoginPageProps) {
  const suppliedToken = searchParams?.demo;
  const demoToken = isValidDemoAccessToken(suppliedToken) ? suppliedToken : undefined;

  return (
    <AuthShell
      badge="For LiveMopay prepaid accounts"
      title={
        <>
          Your usage. <span className="text-brandGreen">Finally clear.</span>
        </>
      }
      description="Real charts, real history, and a running balance you can actually trust, pulled straight from LiveMopay."
    >
      <LoginForm demoToken={demoToken} />
    </AuthShell>
  );
}
