import "server-only";

import { deviceKeyHint, generateDeviceKey, hashDeviceKey, parseBearerDeviceKey } from "./meter-device-keys";
import { adminSupabaseRawResponse, adminSupabaseRequest } from "./supabase-rest";
import { getOrCreateUserPermissions } from "./user-roles";

// The authenticated device identity. This -- never anything from the request
// body -- decides which device owns the pulse rows, so a request can't spoof
// another device by supplying a foreign device_id/connection_id.
export type MeterDevice = {
  id: string;
  connectionId: string;
  // The user who owns the connection this device is attached to. The live-meter
  // feature flag is checked against this user, so the whole feature can be
  // gated per user (like activities) even though the request itself is
  // device-authenticated, not session-authenticated.
  ownerUserId: string;
  name: string;
  enabled: boolean;
  pulsesPerKwh: number;
};

type MeterDeviceRow = {
  id: string;
  connection_id: string;
  name: string;
  enabled: boolean;
  pulses_per_kwh: number;
  // PostgREST embedded parent (one-to-one via the connection_id FK).
  livemopay_connections: { user_id: string } | null;
};

// Embeds the owning connection's user_id via the connection_id foreign key.
const DEVICE_SELECT = "id,connection_id,name,enabled,pulses_per_kwh,livemopay_connections(user_id)";

function toDevice(row: MeterDeviceRow): MeterDevice | null {
  const ownerUserId = row.livemopay_connections?.user_id;
  if (!ownerUserId) {
    return null;
  }

  return {
    id: row.id,
    connectionId: row.connection_id,
    ownerUserId,
    name: row.name,
    enabled: row.enabled,
    pulsesPerKwh: row.pulses_per_kwh
  };
}

// Resolves the device behind an `Authorization: Bearer <key>` header. Returns
// null for every failure mode -- missing/malformed header, unknown key, or a
// disabled device -- so the route can answer with one indistinguishable 401 and
// never leak which case occurred. The raw key is only ever hashed here; it is
// never logged. Service-role read, filtered by the exact hash (unique column),
// so it returns the one matching device or nothing.
export async function authenticateDeviceKey(
  authorizationHeader: string | null | undefined
): Promise<MeterDevice | null> {
  const rawKey = parseBearerDeviceKey(authorizationHeader);
  if (!rawKey) {
    return null;
  }

  const hash = hashDeviceKey(rawKey);
  const rows = await adminSupabaseRequest<MeterDeviceRow[]>(
    "GET",
    `/meter_devices?select=${DEVICE_SELECT}&api_key_hash=eq.${encodeURIComponent(hash)}&limit=1`
  );

  const row = rows[0];
  if (!row || !row.enabled) {
    return null;
  }

  return toDevice(row);
}

// The device's owner has the live-meter feature enabled. Kept out of
// authenticateDeviceKey so the 401 (bad credentials) and 403 (feature off for
// this owner) cases stay distinct in the route.
export async function isLiveMeterEnabledForDevice(device: MeterDevice): Promise<boolean> {
  const permissions = await getOrCreateUserPermissions(device.ownerUserId);
  return permissions.liveMeterEnabled;
}

export type PulseInput = {
  seq: number;
  timestampMs: number;
  uptimeMs: number;
  deltaMs: number | null;
};

type MeterPulseInsertRow = {
  device_id: string;
  boot_id: string;
  seq: number;
  observed_at: string;
  uptime_ms: number;
  delta_ms: number | null;
};

// Pure mapping from validated wire pulses to database rows. device_id is bound
// here from the authenticated device, and timestampMs is converted to an ISO
// timestamptz for observed_at. Kept separate from the DB call so the mapping
// (and the timestamp conversion in particular) is unit-testable without any
// network.
export function buildPulseRows(deviceId: string, bootId: string, pulses: PulseInput[]): MeterPulseInsertRow[] {
  return pulses.map((pulse) => ({
    device_id: deviceId,
    boot_id: bootId,
    seq: pulse.seq,
    observed_at: new Date(pulse.timestampMs).toISOString(),
    uptime_ms: pulse.uptimeMs,
    delta_ms: pulse.deltaMs
  }));
}

export type RecordPulsesResult = {
  accepted: number;
  duplicates: number;
};

// Idempotent bulk insert. Uses PostgREST's `resolution=ignore-duplicates`
// against the (device_id, boot_id, seq) unique constraint, so a retried batch
// silently skips rows that already exist -- no read-then-write race. With
// `return=representation` only the rows actually inserted come back, so
// accepted = returned count and duplicates = submitted - accepted.
export async function recordPulses(
  deviceId: string,
  bootId: string,
  pulses: PulseInput[]
): Promise<RecordPulsesResult> {
  const rows = buildPulseRows(deviceId, bootId, pulses);

  const inserted = await adminSupabaseRequest<Array<{ id: number }>>(
    "POST",
    "/meter_pulses?on_conflict=device_id,boot_id,seq&select=id",
    rows,
    "resolution=ignore-duplicates,return=representation"
  );

  const accepted = inserted.length;
  return { accepted, duplicates: rows.length - accepted };
}

// Best-effort liveness stamp, called after a batch is successfully stored. A
// failure here must not fail the ingestion request -- the pulses are already
// safely persisted -- so the error is swallowed with a non-secret log line.
export async function touchDeviceLastSeen(deviceId: string): Promise<void> {
  const response = await adminSupabaseRawResponse(
    "PATCH",
    `/meter_devices?id=eq.${encodeURIComponent(deviceId)}`,
    { last_seen_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    "return=minimal"
  );

  if (!response.ok) {
    console.error(`Failed to update meter_devices.last_seen_at (${response.status})`);
  }
}

export type CreateMeterDeviceResult = {
  deviceId: string;
  rawKey: string;
};

// Used by the admin CLI (scripts/create-meter-device.ts). Generates a key,
// stores ONLY its hash plus a harmless hint, and returns the raw key to be
// printed exactly once. The raw key is never persisted or logged from here.
export async function createMeterDevice(
  connectionId: string,
  name: string,
  pulsesPerKwh = 1000
): Promise<CreateMeterDeviceResult> {
  const rawKey = generateDeviceKey();

  const rows = await adminSupabaseRequest<Array<{ id: string }>>(
    "POST",
    "/meter_devices?select=id",
    [
      {
        connection_id: connectionId,
        name,
        api_key_hash: hashDeviceKey(rawKey),
        key_hint: deviceKeyHint(rawKey),
        pulses_per_kwh: pulsesPerKwh
      }
    ],
    "return=representation"
  );

  return { deviceId: rows[0].id, rawKey };
}

export type ActiveConnection = {
  id: string;
  livemopayEmail: string;
};

// Resolves a user's single active (connected) LiveMopay connection, which a new
// meter device is attached to. Returns null when the user has no such
// connection so the CLI can fail clearly rather than creating an orphan device.
export async function getActiveConnectionForUser(userId: string): Promise<ActiveConnection | null> {
  const rows = await adminSupabaseRequest<Array<{ id: string; livemopay_email: string }>>(
    "GET",
    `/livemopay_connections?select=id,livemopay_email&user_id=eq.${encodeURIComponent(userId)}&status=eq.connected&limit=1`
  );

  const row = rows[0];
  return row ? { id: row.id, livemopayEmail: row.livemopay_email } : null;
}
