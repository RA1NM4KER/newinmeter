// Admin/developer CLI: registers a physical meter device and prints its raw
// key exactly once. Attaches the device to the target user's active LiveMopay
// connection, so live telemetry inherits the same ownership model as the rest
// of their data. Only the SHA-256 hash of the key is stored -- the raw key
// printed here is a secret: paste it into the Mac bridge / ESP32 config and
// never commit it.
//
// Usage:
//   npm run create:meter-device -- --email <user-email> --name "Home meter"
//   npm run create:meter-device -- --email <user-email> --name "Home meter" --pulses-per-kwh 1000
//
// Runs with the repo's service-role setup via the npm script, which uses
// `tsx --conditions=react-server --env-file=.env.local`. The
// `--conditions=react-server` flag is required: the server-only lib modules
// this pulls in (meter-devices -> supabase-rest) start with
// `import "server-only"`, whose default export throws by design. Next.js
// resolves that marker's `react-server` export condition (an empty no-op
// module); direct Node/tsx execution does not, so the flag makes the marker
// resolve the same harmless way here instead of throwing at import.
//
// Deliberately does NOT import hasFeatureAccess from @/lib/features: that
// module imports `cache` from "react" at the top level (for real
// per-request dedup in the app), and merely importing `cache` under
// --conditions=react-server throws at load time regardless of whether it's
// ever called ("This entry point is not yet supported outside of
// experimental channels", react.shared-subset.development.js), a separate
// failure from the server-only one this file's own comment above already
// covers. See docs/debugging-runbook.md. meter-devices.ts's own
// isLiveMeterEnabledForDevice needed the same fix (a lazy `import()` there
// instead of a top-level one), since importing it at all pulled features.ts
// into this script's module graph even though this script never calls that
// function. A CLI run never benefits from React's cache anyway (one
// process, one check), so checkLiveFeatureAccess below is the same
// rollout+override resolution with the caching stripped out.

import { adminSupabaseFetch } from "@/lib/supabase-rest";
import { createMeterDevice, getActiveConnectionForUser } from "@/lib/meter-devices";
import { createSupabaseAdminClient } from "@/lib/supabase/admin-client";

async function checkLiveFeatureAccess(userId: string): Promise<boolean> {
  const [rolloutRows, overrideRows] = await Promise.all([
    adminSupabaseFetch<{ rollout_mode: string }[]>("/feature_rollouts?select=rollout_mode&feature_key=eq.live"),
    adminSupabaseFetch<{ enabled: boolean }[]>(
      `/feature_overrides?select=enabled&user_id=eq.${encodeURIComponent(userId)}&feature_key=eq.live&limit=1`
    )
  ]);

  const mode = rolloutRows[0]?.rollout_mode ?? "off";
  const override = overrideRows[0]?.enabled;

  if (mode === "off") return false;
  if (override !== undefined) return override;
  return mode === "everyone";
}

function parseArgs(argv: string[]): Map<string, string> {
  const args = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) {
        args.set(key, "");
      } else {
        args.set(key, value);
        i += 1;
      }
    }
  }
  return args;
}

// Supabase Auth's admin API has no email lookup, so page through listUsers and
// match case-insensitively -- the same approach the admin user list already
// uses (src/lib/user-roles.ts).
async function findUserIdByEmail(email: string): Promise<{ id: string; email: string } | null> {
  const admin = createSupabaseAdminClient();
  const target = email.trim().toLowerCase();

  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) {
      throw new Error(error.message);
    }

    const match = data.users.find((user) => (user.email ?? "").toLowerCase() === target);
    if (match) {
      return { id: match.id, email: match.email ?? email };
    }

    if (data.users.length < 1000) {
      return null;
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const email = args.get("email");
  const name = args.get("name");
  const pulsesPerKwhRaw = args.get("pulses-per-kwh");

  if (!email || !name) {
    console.error(
      'Usage: npm run create:meter-device -- --email <user-email> --name "Home meter" [--pulses-per-kwh 1000]'
    );
    process.exitCode = 1;
    return;
  }

  let pulsesPerKwh = 1000;
  if (pulsesPerKwhRaw) {
    const parsed = Number(pulsesPerKwhRaw);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      console.error("--pulses-per-kwh must be a positive integer.");
      process.exitCode = 1;
      return;
    }
    pulsesPerKwh = parsed;
  }

  const user = await findUserIdByEmail(email);
  if (!user) {
    console.error(`No NewinMeter user found for email: ${email}`);
    process.exitCode = 1;
    return;
  }

  // Refuse to register a device for a user who doesn't have the live-meter
  // feature enabled -- the feature is gated by this one permission end to end.
  const liveMeterEnabled = await checkLiveFeatureAccess(user.id);
  if (!liveMeterEnabled) {
    console.error(
      `User ${user.email} does not have the live-meter feature enabled. ` +
        "Enable it from the admin Features tab (or that user's drawer) before registering a device."
    );
    process.exitCode = 1;
    return;
  }

  const connection = await getActiveConnectionForUser(user.id);
  if (!connection) {
    console.error(
      `User ${user.email} has no active (connected) LiveMopay connection. ` +
        "Connect a LiveMopay account for this user before registering a device."
    );
    process.exitCode = 1;
    return;
  }

  const { deviceId, rawKey } = await createMeterDevice(connection.id, name, pulsesPerKwh);

  console.log("");
  console.log(`Registered meter device "${name}" for ${user.email}`);
  console.log(`Connection: ${connection.id} (${connection.livemopayEmail})`);
  console.log(`Pulses/kWh: ${pulsesPerKwh}`);
  console.log("");
  console.log("Store this key now -- it is shown only once and is a secret:");
  console.log("");
  console.log(`  Device ID:  ${deviceId}`);
  console.log(`  Device key: ${rawKey}`);
  console.log("");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
