import { DocumentShell, Section } from "@/components/layout/document-shell";
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "@/lib/site-config";

export const metadata = {
  title: "Terms of Service - NewinMeter"
};

export default function TermsOfServicePage() {
  return (
    <DocumentShell title="Terms of Service" updated="26 July 2026">
      <p className="text-ink/80">
        By creating a NewinMeter account or connecting a LiveMopay account, you agree to these terms. Please read them.
      </p>

      <Section title="What NewinMeter is">
        <p>
          NewinMeter is a community-built dashboard for Newinbosch residents. It reads the electricity and water usage
          data already available in your own LiveMopay account and presents it as dashboards, history, and an optional
          AI assistant. NewinMeter is an independent project and is not affiliated with, endorsed by, or operated by
          Newinbosch HOA, Livewire, or LiveMopay.
        </p>
      </Section>

      <Section title="Your account">
        <ul className="list-disc pl-5">
          <li>You must connect a LiveMopay account that belongs to you, using accurate credentials.</li>
          <li>You&apos;re responsible for keeping your sign-in access to NewinMeter secure.</li>
          <li>
            Don&apos;t use NewinMeter to access, sync, or view another person&apos;s LiveMopay account without their
            permission.
          </li>
        </ul>
      </Section>

      <Section title="Data accuracy">
        <p>
          NewinMeter displays data as reported by LiveMopay. We don&apos;t control or guarantee the accuracy,
          completeness, or timeliness of that underlying data, including balances, tariffs, or usage readings.
          Don&apos;t rely on NewinMeter as your sole source before making a payment or purchase decision: always confirm
          important balances directly with LiveMopay.
        </p>
      </Section>

      <Section title="The AI assistant">
        <p>
          The energy assistant generates answers using an AI model based on your usage data. Its answers can be wrong or
          misleading. It doesn&apos;t provide financial, legal, or professional advice, and shouldn&apos;t be treated as
          such.
        </p>
      </Section>

      <Section title="Service availability">
        <p>
          NewinMeter is provided on an as-is, as-available basis, with no uptime guarantee. Features, or the service
          itself, may change or be discontinued at any time.
        </p>
      </Section>

      <Section title="Disclaimer and limitation of liability">
        <p>
          NewinMeter is provided without warranties of any kind, express or implied. To the fullest extent permitted by
          law, NewinMeter and its operator are not liable for any indirect, incidental, or consequential damages arising
          from your use of the service, including reliance on inaccurate or delayed usage data.
        </p>
      </Section>

      <Section title="Ending your account">
        <p>
          You may disconnect your LiveMopay account, or permanently delete your NewinMeter account and all your data, at
          any time from Settings. Deletion is immediate and self-service; you don&apos;t need to contact anyone. We may
          suspend or terminate access for accounts used to access data without authorization, or in a way that abuses or
          disrupts the service.
        </p>
      </Section>

      <Section title="Changes to these terms">
        <p>If these terms change meaningfully, we&apos;ll update this page and the date at the top.</p>
      </Section>

      <Section title="Governing law">
        <p>These terms are governed by the laws of South Africa.</p>
      </Section>

      <Section title="Contact">
        <p>
          Questions about these terms? Email{" "}
          <a className="text-accent hover:underline" href={SUPPORT_MAILTO}>
            {SUPPORT_EMAIL}
          </a>
          .
        </p>
      </Section>
    </DocumentShell>
  );
}
