import { AuthShell } from "@/components/auth/auth-shell";
import { LoginForm } from "@/components/auth/login-form";
import { isValidDemoAccessToken } from "@/lib/demo/access-token";

export const dynamic = "force-dynamic";

type LoginPageProps = {
  searchParams?: { demo?: string };
};

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
