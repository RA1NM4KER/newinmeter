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
// this pulls in (meter-devices -> supabase-rest/user-roles) start with
// `import "server-only"`, whose default export throws by design. Next.js
// resolves that marker's `react-server` export condition (an empty no-op
// module); direct Node/tsx execution does not, so the flag makes the marker
// resolve the same harmless way here instead of throwing at import.

import { createMeterDevice, getActiveConnectionForUser } from "../src/lib/meter-devices";
import { createSupabaseAdminClient } from "../src/lib/supabase/admin-client";
import { getOrCreateUserPermissions } from "../src/lib/user-roles";

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
  const permissions = await getOrCreateUserPermissions(user.id);
  if (!permissions.liveMeterEnabled) {
    console.error(
      `User ${user.email} does not have the live-meter feature enabled. ` +
        "Enable it from the admin users table (Live meter toggle) before registering a device."
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
