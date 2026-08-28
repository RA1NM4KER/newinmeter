// CLI entry point for (re)provisioning the shared demo NewinMeter account.
// The actual work lives in src/lib/demo/reset.ts, shared with the daily
// public-demo reset cron (src/app/api/cron/reset-demo/route.ts) so both
// callers can never drift.
//
// This account has no password. Sign-in goes through /api/demo-login (a
// server-generated Supabase magic link) -- see the README "Demo account"
// section. The recruiter/private link (?demo=<token>) requires
// NEWINMETER_DEMO_ACCESS_TOKEN; the public "Explore demo" button on /login
// needs no token at all.
//
// Usage:
//   NEWINMETER_DEMO_EMAIL=demo@example.com npm run seed:demo-account
//
// Requires the same Supabase service-role env vars as the app
// (SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SUPABASE_URL) -- see .env.local.

import { resetDemoAccount } from "@/lib/demo/reset";

async function main() {
  const email = process.env.NEWINMETER_DEMO_EMAIL;

  if (!email) {
    console.error("Refusing to run: NEWINMETER_DEMO_EMAIL is not set.");
    process.exitCode = 1;
    return;
  }

  const summary = await resetDemoAccount(email);

  console.log("\nDemo account ready:");
  console.log(`  email: ${summary.email}`);
  console.log(`  user id: ${summary.userId}`);
  console.log(`  connection id: ${summary.connectionId}`);
  console.log(`  date range: ${summary.startDate} to ${summary.endDate} (${summary.days} days)`);
  console.log(`  energy rows: ${summary.energyRows}`);
  console.log(`  activities: ${summary.activities}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
