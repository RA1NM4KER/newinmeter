import { AuthShell } from "@/components/auth/auth-shell";
import { LoginForm } from "@/components/auth/login-form";
import { isValidDemoAccessToken } from "@/lib/demo/access-token";

export const metadata = {
  title: "NewinMeter | See what your electricity was doing",
  description: "Explore prepaid electricity usage, add household context, ask what changed, and get useful alerts."
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
      badge="NewinMeter for LiveMopay"
      title={
        <>
          See what your electricity <span className="text-brandTeal">was doing.</span>
        </>
      }
      description="Turn your prepaid history into days you can explore, label, question, and watch — without guessing where the money went."
    >
      <LoginForm demoToken={demoToken} />
    </AuthShell>
  );
}
