import { AuthShell } from "@/components/auth/auth-shell";
import { LoginForm } from "@/components/auth/login-form";
import { isValidDemoAccessToken } from "@/lib/demo/access-token";

export const metadata = {
  title: "NewinMeter | Understand your prepaid electricity",
  description: "See your LiveMopay balance, spend, usage, history, explanations, and alerts in one clear view."
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
      badge="Prepaid electricity, clearly explained"
      title={
        <>
          Know where your prepaid electricity <span className="text-brandTeal">is going.</span>
        </>
      }
      description="Connect your LiveMopay account to see usage, spend, balance, and history — then understand unusual days and get alerted when something needs attention."
    >
      <LoginForm demoToken={demoToken} />
    </AuthShell>
  );
}
