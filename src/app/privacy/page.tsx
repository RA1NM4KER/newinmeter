import { DocumentShell, Section } from "@/components/layout/document-shell";
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "@/lib/site-config";

export const metadata = {
  title: "Privacy Policy - NewinMeter"
};

export default function PrivacyPolicyPage() {
  return (
    <DocumentShell title="Privacy Policy" updated="26 July 2026">
      <p className="text-ink/80">
        NewinMeter is a community-built dashboard for Newinbosch residents that connects to your own LiveMopay prepaid
        electricity and water account and turns your existing usage data into charts, history, and balance tracking.
        This page explains what we collect, why, and how it&apos;s handled.
      </p>

      <Section title="What we collect">
        <ul className="list-disc pl-5">
          <li>
            Your email address, used to sign you in. You can use a magic link or continue with Google. We never see or
            store a password.
          </li>
          <li>
            Your LiveMopay password, which you provide once to connect your account. It&apos;s used exactly once,
            server-side, to establish that connection, and is never stored, not even encrypted. What we do store is an
            encrypted (AES-256-GCM) refresh token, which lets us sync your data on your behalf without ever holding your
            password.
          </li>
          <li>
            The usage data itself: electricity and water spend, consumption, tariffs, balance, and meter/account
            details, as reported by LiveMopay for your account.
          </li>
          <li>Your display preference (light/dark/system), stored only in your browser, never on our servers.</li>
        </ul>
      </Section>

      <Section title="How it's used">
        <p>
          Your data is used to build the dashboards, charts, and tables you see in NewinMeter, and to answer questions
          you ask the built-in energy assistant. We don&apos;t use your data for advertising, and we don&apos;t sell it
          to anyone.
        </p>
      </Section>

      <Section title="Who else sees it">
        <ul className="list-disc pl-5">
          <li>
            <strong className="text-ink">LiveMopay.</strong> Your usage data originates from your own LiveMopay account;
            NewinMeter reads it using the credentials you provide. NewinMeter is an independent community project and is
            not affiliated with or endorsed by Newinbosch HOA, Livewire, or LiveMopay.
          </li>
          <li>
            <strong className="text-ink">OpenAI.</strong> When you ask the energy assistant a question, that question
            and the usage/spend figures needed to answer it (for your selected date range) are sent to OpenAI to
            generate a response. No LiveMopay credentials are ever included in that request.
          </li>
          <li>
            <strong className="text-ink">Supabase.</strong> Our database and authentication provider, which stores your
            account row and encrypted tokens.
          </li>
          <li>
            <strong className="text-ink">Vercel.</strong> Our hosting provider, which serves the app and may log
            standard request metadata (IP address, timestamps) for operational purposes.
          </li>
        </ul>
      </Section>

      <Section title="Security">
        <p>
          Your LiveMopay password is never stored, in any form. The encrypted refresh token we do store is never sent to
          your browser. Row-level security in our database ensures your data is only ever readable by your own account.
          Disconnecting your LiveMopay connection (from Settings) clears the stored refresh token immediately, while
          keeping your historical usage data intact.
        </p>
      </Section>

      <Section title="Your choices">
        <ul className="list-disc pl-5">
          <li>Disconnect your LiveMopay account at any time from Settings.</li>
          <li>Sign out at any time; this ends your session but doesn&apos;t delete your data.</li>
          <li>
            Permanently delete your account and all your data yourself, any time, from Settings. This removes your
            LiveMopay connection, every synced usage row, and your sign-in, immediately and without needing to contact
            anyone.
          </li>
        </ul>
      </Section>

      <Section title="Changes to this policy">
        <p>
          If how we handle your data changes meaningfully, we&apos;ll update this page and change the date at the top.
        </p>
      </Section>

      <Section title="Contact">
        <p>
          Questions about your data? Email{" "}
          <a className="text-accent hover:underline" href={SUPPORT_MAILTO}>
            {SUPPORT_EMAIL}
          </a>
          .
        </p>
      </Section>
    </DocumentShell>
  );
}
