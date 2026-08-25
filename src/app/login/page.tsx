import { AuthShell } from "@/components/auth/auth-shell";
import { LoginForm } from "@/components/auth/login-form";
import { isValidDemoAccessToken } from "@/lib/demo/access-token";

export const metadata = {
  title: "NewinMeter | Your electricity, finally explained",
  description: "Understand prepaid electricity usage and get useful alerts. Free for Newinbosch residents."
};

export const dynamic = "force-dynamic";

type LoginPageProps = {
  searchParams?: { demo?: string };
};

export default function LoginPage({ searchParams }: LoginPageProps) {
  const suppliedToken = searchParams?.demo;
  const demoToken = isValidDemoAccessToken(suppliedToken) ? suppliedToken : undefined;

  return (
    <AuthShell
      title={
        <>
          Your electricity.
          <br />
          <span className="text-brandTeal">Finally explained.</span>
        </>
      }
      description="See where your prepaid electricity went, understand unusual usage, and get warned when something needs attention."
    >
      <LoginForm demoToken={demoToken} />
    </AuthShell>
  );
}
