import "server-only";

import { z } from "zod";
import {
  getNewinmeterFirebaseApiKey,
  getNewinmeterWebAppFlavor,
  getNewinmeterWebBaseUrl,
  getNewinmeterWebPortalOrigin
} from "../env";

const ENERGY_LABEL_RE = /^(.+?) \((\d{4}-\d{2}-\d{2} \d{2}:\d{2})\)$/;
const WATER_LABEL_RE = /^(Water:.+?) \((\d{4}-\d{2}-\d{2} \d{2}:\d{2})(?: to \d{4}-\d{2}-\d{2} \d{2}:\d{2})?\)$/;
const FIXED_LABEL_RE = /^(Daily .+?) - (\d{4}-\d{2}-\d{2})$/;
// Credits whose description mentions a refund (e.g. "Incorrect Tariff Refund")
// reverse an earlier overcharge rather than being a wallet top-up. Matched
// generically on the word so any "<something> Refund" is recognised.
const REFUND_LABEL_RE = /refund/i;

// Shared so the sync-time cleanup classifies a stored charge_label exactly the
// same way the parser does when it assigns one.
export function isRefundLabel(label: string) {
  return REFUND_LABEL_RE.test(label);
}
const ENERGY_UNITS_RE = /(-?[\d.]+)\s*kWh\s*@\s*R(-?[\d.]+)/;
const WATER_UNITS_RE = /(-?[\d.]+)\s*kL\s*@\s*R(-?[\d.]+)/;
const FIXED_UNITS_RE = /(-?[\d.]+)\s*@\s*R(-?[\d.]+)/;

export const newinmeterFieldNames = [
  "capture_dt",
  "source_ts",
  "charge_label",
  "period_dt",
  "kwh",
  "water_kl",
  "tariff",
  "cost",
  "balance"
] as const;

export type NewinmeterFieldName = (typeof newinmeterFieldNames)[number];

export type NewinmeterCsvRow = Record<NewinmeterFieldName, string>;

export type LiveMopaySession = {
  idToken: string;
  refreshToken: string;
  expiresAt: string;
  localId?: string;
};

export type LiveMopayAccountCandidate = {
  accountId: string;
  companyId: string;
  propertyId: string;
  label: string;
};

type LedgerApiRow = {
  balance?: string | null;
  balanceIncl?: string | null;
  credit?: string | null;
  creditIncl?: string | null;
  date: string;
  debit?: string | null;
  debitIncl?: string | null;
  description?: string | null;
  id?: string | number | null;
  unitsDescription?: string | null;
  unitsDescriptionIncl?: string | null;
};

function envString(name: string, fallback?: string) {
  const value = process.env[name];
  return value && value.length ? value : fallback;
}

const localTimeZone = envString("NEWINMETER_TIMEZONE", "Africa/Johannesburg")!;
const authHeaderName = envString("NEWINMETER_WEB_AUTH_HEADER", "Authorization")!;
const authScheme = envString("NEWINMETER_WEB_AUTH_SCHEME", "Bearer")!;
const acceptLanguage = envString("NEWINMETER_WEB_ACCEPT_LANGUAGE", "en-US,en;q=0.9")!;
const userAgent =
  envString("NEWINMETER_WEB_USER_AGENT") ||
  [
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
    "AppleWebKit/537.36 (KHTML, like Gecko)",
    "Chrome/136.0.0.0 Safari/537.36"
  ].join(" ");

const localDateFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: localTimeZone,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false
});

const localYearFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: localTimeZone,
  year: "numeric"
});

function formatLocalCaptureDate(value: string) {
  const parts = localDateFormatter.formatToParts(new Date(value));
  const day = parts.find((part) => part.type === "day")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const year = parts.find((part) => part.type === "year")?.value;
  const hour = parts.find((part) => part.type === "hour")?.value;
  const minute = parts.find((part) => part.type === "minute")?.value;

  if (!day || !month || !year || !hour || !minute) {
    throw new Error(`Could not format capture timestamp ${value}.`);
  }

  return `${day}/${month}/${year} ${hour}:${minute}`;
}

function captureDateToPeriodDate(value: string) {
  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})$/);
  if (!match) {
    throw new Error(`Invalid capture_dt ${value}.`);
  }

  const [, day, month, year, hour, minute] = match;
  return `${year}-${month}-${day} ${hour}:${minute}`;
}

function parseMoney(value: string | null | undefined) {
  return (value || "").trim().replaceAll("R", "").replaceAll(",", "") || "0";
}

// Flips the sign of an already-parsed money string. Used to store refunds as a
// negative spend so they reduce net spend in the downstream rollups.
function negateMoney(value: string) {
  if (value === "0" || value === "") {
    return "0";
  }
  return value.startsWith("-") ? value.slice(1) : `-${value}`;
}

function normalizeNumericString(value: string, scale: number) {
  const trimmed = value.trim();
  if (!trimmed) {
    return (0).toFixed(scale);
  }

  const numeric = Number(trimmed);
  if (!Number.isFinite(numeric)) {
    return trimmed;
  }

  return numeric.toFixed(scale);
}

export function newinmeterLedgerKey(row: Pick<NewinmeterCsvRow, "charge_label" | "period_dt" | "cost" | "balance">) {
  return [
    row.charge_label.trim(),
    row.period_dt.trim(),
    normalizeNumericString(row.cost, 2),
    normalizeNumericString(row.balance, 2)
  ].join("|");
}

async function readJsonResponse<T>(response: Response, context: string) {
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`${context} failed with ${response.status}: ${text}`);
  }

  return (text ? JSON.parse(text) : null) as T;
}

async function postJson<T>(url: string, payload: unknown, headers?: Record<string, string>) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(headers ?? {})
    },
    body: JSON.stringify(payload),
    cache: "no-store"
  });

  return readJsonResponse<T>(response, `POST ${url}`);
}

async function postForm<T>(url: string, payload: Record<string, string>, headers?: Record<string, string>) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      ...(headers ?? {})
    },
    body: new URLSearchParams(payload).toString(),
    cache: "no-store"
  });

  return readJsonResponse<T>(response, `POST ${url}`);
}

async function getJson<T>(url: string, headers: Record<string, string>) {
  const response = await fetch(url, {
    method: "GET",
    headers,
    cache: "no-store"
  });

  return readJsonResponse<T>(response, `GET ${url}`);
}

function expiresAtFromSeconds(expiresIn: string | number) {
  return new Date(Date.now() + Number(expiresIn) * 1000).toISOString();
}

// Thrown when Firebase Identity Toolkit rejects the email/password itself
// (wrong password, unknown email, disabled account) -- distinguished from a
// generic/network/server failure so the connect route can show copy the
// resident can actually act on instead of "NewinMeter is broken".
export class LiveMopayInvalidCredentialsError extends Error {
  constructor() {
    super("LiveMopay rejected this email/password combination.");
    this.name = "LiveMopayInvalidCredentialsError";
  }
}

// Firebase's own throttle on repeated failed attempts against one account --
// distinct from NewinMeter's own rate limiting, and worth its own copy since
// retrying immediately will not help.
export class LiveMopayTooManyAttemptsError extends Error {
  constructor() {
    super("LiveMopay has temporarily blocked sign-in attempts for this account.");
    this.name = "LiveMopayTooManyAttemptsError";
  }
}

// Identity Toolkit's documented signInWithPassword error codes. Older
// projects return the specific EMAIL_NOT_FOUND/INVALID_PASSWORD pair; newer
// ones collapse both into INVALID_LOGIN_CREDENTIALS to avoid confirming
// which part was wrong. Both shapes are treated identically here -- the
// caller only needs "the credentials were wrong", never which half.
const INVALID_CREDENTIALS_CODES = new Set([
  "EMAIL_NOT_FOUND",
  "INVALID_PASSWORD",
  "INVALID_LOGIN_CREDENTIALS",
  "INVALID_EMAIL",
  "USER_DISABLED"
]);

export async function loginWithLiveMopayCredentials(email: string, password: string): Promise<LiveMopaySession> {
  const apiKey = getNewinmeterFirebaseApiKey();
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
    cache: "no-store"
  });

  const text = await response.text();

  if (!response.ok) {
    // Never logged or included in a thrown message here -- only the
    // Identity Toolkit error *code* (never the password) drives which typed
    // error comes back.
    let code = "";
    try {
      code = (JSON.parse(text)?.error?.message as string | undefined) ?? "";
    } catch {
      // Non-JSON body (e.g. an upstream 5xx HTML page) -- treated as a
      // generic failure below.
    }

    if (code === "TOO_MANY_ATTEMPTS_TRY_LATER") {
      throw new LiveMopayTooManyAttemptsError();
    }
    if (INVALID_CREDENTIALS_CODES.has(code)) {
      throw new LiveMopayInvalidCredentialsError();
    }
    throw new Error(`POST ${url} failed with ${response.status}: ${text}`);
  }

  const parsed = (text ? JSON.parse(text) : {}) as {
    idToken: string;
    refreshToken: string;
    expiresIn: string;
    localId?: string;
  };

  return {
    idToken: parsed.idToken,
    refreshToken: parsed.refreshToken,
    expiresAt: expiresAtFromSeconds(parsed.expiresIn),
    localId: parsed.localId
  };
}

export async function refreshLiveMopaySession(refreshToken: string): Promise<LiveMopaySession> {
  const apiKey = getNewinmeterFirebaseApiKey();
  const response = await postForm<{
    id_token: string;
    refresh_token: string;
    expires_in: string;
    user_id?: string;
  }>(`https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(apiKey)}`, {
    grant_type: "refresh_token",
    refresh_token: refreshToken
  });

  return {
    idToken: response.id_token,
    refreshToken: response.refresh_token,
    expiresAt: expiresAtFromSeconds(response.expires_in),
    localId: response.user_id
  };
}

function decodeJwtClaims(token: string) {
  const parts = token.split(".");
  if (parts.length < 2) {
    throw new Error("Invalid JWT: expected at least two segments.");
  }

  return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as Record<string, unknown>;
}

const LiveMopayJwtClaimsSchema = z
  .object({
    company_id: z.union([z.string(), z.number()]).optional(),
    property_id: z.union([z.string(), z.number()]).optional()
  })
  .passthrough();

function claimsFromIdToken(idToken: string) {
  const decoded = decodeJwtClaims(idToken);
  const parsed = LiveMopayJwtClaimsSchema.safeParse(decoded);
  return parsed.success ? parsed.data : {};
}

// Base headers shared by every authenticated LiveMopay web-app request.
function buildAuthHeaders(idToken: string): Record<string, string> {
  const portalOrigin = getNewinmeterWebPortalOrigin();

  return {
    [authHeaderName]: `${authScheme} ${idToken}`.trim(),
    Accept: "*/*",
    "Accept-Language": acceptLanguage,
    appflavor: getNewinmeterWebAppFlavor(),
    Origin: portalOrigin,
    Referer: `${portalOrigin.replace(/\/$/, "")}/`,
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "cross-site",
    "User-Agent": userAgent
  };
}

// Account discovery must not require an account id -- that's the value we're
// trying to discover. Company/property, when known from the JWT, narrow the
// discovery request; when not, discovery is attempted without them.
function buildAccountDiscoveryHeaders(idToken: string): Record<string, string> {
  const claims = claimsFromIdToken(idToken);
  const headers = buildAuthHeaders(idToken);

  if (claims.company_id !== undefined) {
    headers.companyid = String(claims.company_id);
  }

  if (claims.property_id !== undefined) {
    headers.propertyid = String(claims.property_id);
  }

  return headers;
}

function buildLedgerHeaders(
  idToken: string,
  accountId: string,
  companyId: string,
  propertyId: string
): Record<string, string> {
  return {
    ...buildAuthHeaders(idToken),
    accountid: accountId,
    companyid: companyId,
    propertyid: propertyId
  };
}

const DiscoveryPayloadSchema = z.union([z.array(z.record(z.unknown())), z.record(z.unknown())]);

function readIdLikeField(item: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = item[key];
    if (value !== undefined && value !== null && value !== "") {
      return String(value);
    }
  }

  return undefined;
}

// The response shape of GET /mobile/ for discovery-only headers (no
// accountid) has not been observed against a real account -- see
// MULTI_USER_SETUP.md "LiveMopay discovery uncertainties". This parses
// defensively: any array (or single object treated as a one-item array) of
// records that expose an id-like field and resolvable company/property ids.
// Items missing an id, or missing both a discovered and a JWT-fallback
// company/property id, are skipped rather than assumed.
export async function discoverLiveMopayAccounts(idToken: string): Promise<LiveMopayAccountCandidate[]> {
  const claims = claimsFromIdToken(idToken);
  const fallbackCompanyId = claims.company_id !== undefined ? String(claims.company_id) : undefined;
  const fallbackPropertyId = claims.property_id !== undefined ? String(claims.property_id) : undefined;

  const payload = await getJson<unknown>(
    `${getNewinmeterWebBaseUrl().replace(/\/$/, "")}/mobile/`,
    buildAccountDiscoveryHeaders(idToken)
  );

  const parsed = DiscoveryPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    return [];
  }

  const items = Array.isArray(parsed.data) ? parsed.data : [parsed.data];
  const candidates: LiveMopayAccountCandidate[] = [];

  for (const item of items) {
    const accountId = readIdLikeField(item, ["accountId", "id"]);
    if (!accountId) {
      continue;
    }

    const companyId = readIdLikeField(item, ["companyId", "company_id"]) ?? fallbackCompanyId;
    const propertyId = readIdLikeField(item, ["propertyId", "property_id"]) ?? fallbackPropertyId;
    if (!companyId || !propertyId) {
      continue;
    }

    const label = readIdLikeField(item, ["name", "label", "propertyName", "displayName"]) ?? `Account ${accountId}`;

    candidates.push({ accountId, companyId, propertyId, label });
  }

  return candidates;
}

export function normalizeLedgerRow(item: LedgerApiRow): NewinmeterCsvRow | null {
  const description = (item.description || "").trim();
  const captureDt = formatLocalCaptureDate(item.date);
  const balance = parseMoney(item.balanceIncl || item.balance);

  // Water is checked before energy: WATER_LABEL_RE requires a "Water:"
  // prefix (with either a single timestamp or a "(X to Y)" range), while
  // ENERGY_LABEL_RE is a broad "anything followed by one parenthesized
  // timestamp" catch-all -- broad enough to also match water rows whose
  // description doesn't fit the stricter water pattern. Checking the more
  // specific pattern first means a row only ever falls through to the
  // energy branch if it genuinely isn't a water charge.
  const waterMatch = description.match(WATER_LABEL_RE);
  if (waterMatch) {
    const units = item.unitsDescriptionIncl || item.unitsDescription || "";
    const unitsMatch = units.match(WATER_UNITS_RE);
    if (!unitsMatch) {
      console.warn(`Skipping ledger row: could not parse water units from ${JSON.stringify(units)}.`);
      return null;
    }

    return {
      capture_dt: captureDt,
      source_ts: item.date,
      charge_label: waterMatch[1],
      period_dt: waterMatch[2],
      kwh: "0",
      water_kl: unitsMatch[1],
      tariff: unitsMatch[2],
      cost: parseMoney(item.debitIncl || item.debit),
      balance
    };
  }

  const energyMatch = description.match(ENERGY_LABEL_RE);
  if (energyMatch) {
    const units = item.unitsDescriptionIncl || item.unitsDescription || "";
    const unitsMatch = units.match(ENERGY_UNITS_RE);
    if (!unitsMatch) {
      console.warn(`Skipping ledger row: could not parse energy units from ${JSON.stringify(units)}.`);
      return null;
    }

    return {
      capture_dt: captureDt,
      source_ts: item.date,
      charge_label: energyMatch[1],
      period_dt: energyMatch[2],
      kwh: unitsMatch[1],
      water_kl: "0",
      tariff: unitsMatch[2],
      cost: parseMoney(item.debitIncl || item.debit),
      balance
    };
  }

  const fixedMatch = description.match(FIXED_LABEL_RE);
  if (fixedMatch) {
    const units = item.unitsDescriptionIncl || item.unitsDescription || "";
    const unitsMatch = units.match(FIXED_UNITS_RE);
    if (!unitsMatch) {
      console.warn(`Skipping ledger row: could not parse fixed-charge units from ${JSON.stringify(units)}.`);
      return null;
    }

    return {
      capture_dt: captureDt,
      source_ts: item.date,
      charge_label: fixedMatch[1],
      period_dt: `${fixedMatch[2]} 00:00`,
      kwh: "0",
      water_kl: "0",
      tariff: unitsMatch[2],
      cost: parseMoney(item.debitIncl || item.debit),
      balance
    };
  }

  // A refund is a credit, but unlike a top-up it reverses an earlier overcharge,
  // so it must reduce net spend rather than land in the top-up bucket. Keep the
  // original description as the label (distinct type, no usage) and store the
  // amount as a negative cost.
  if (isRefundLabel(description)) {
    const refund = parseMoney(item.creditIncl || item.credit);
    return {
      capture_dt: captureDt,
      source_ts: item.date,
      charge_label: description,
      period_dt: captureDateToPeriodDate(captureDt),
      kwh: "0",
      water_kl: "0",
      tariff: "0",
      cost: negateMoney(refund),
      balance
    };
  }

  const credit = parseMoney(item.creditIncl || item.credit);
  if (credit !== "0") {
    return {
      capture_dt: captureDt,
      source_ts: item.date,
      charge_label: "Top Up",
      period_dt: captureDateToPeriodDate(captureDt),
      kwh: "0",
      water_kl: "0",
      tariff: "0",
      cost: credit,
      balance
    };
  }

  return null;
}

export function dedupeNewinmeterRows(rows: NewinmeterCsvRow[]) {
  const seen = new Set<string>();
  const unique: NewinmeterCsvRow[] = [];

  for (const row of rows) {
    const key = newinmeterLedgerKey(row);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(row);
  }

  return unique;
}

export async function fetchLiveMopayLedger(params: {
  idToken: string;
  accountId: string;
  companyId: string;
  propertyId: string;
  startDate: string;
}): Promise<NewinmeterCsvRow[]> {
  const payload = await fetchLiveMopayLedgerPayload(params);

  const rows: NewinmeterCsvRow[] = [];

  for (const item of payload) {
    const normalized = normalizeLedgerRow(item as LedgerApiRow);
    if (normalized) {
      rows.push(normalized);
    }
  }

  return dedupeNewinmeterRows(rows);
}

type LiveMopayLedgerRequest = {
  idToken: string;
  accountId: string;
  companyId: string;
  propertyId: string;
  startDate: string;
};

async function fetchLiveMopayLedgerPayload(params: LiveMopayLedgerRequest): Promise<unknown[]> {
  const url =
    `${getNewinmeterWebBaseUrl().replace(/\/$/, "")}/mobile/ledger/${encodeURIComponent(params.startDate)}` +
    `?accountId=${encodeURIComponent(params.accountId)}`;
  const payload = await getJson<unknown>(
    url,
    buildLedgerHeaders(params.idToken, params.accountId, params.companyId, params.propertyId)
  );

  if (!Array.isArray(payload)) {
    throw new Error(`Expected a list from ledger endpoint, got ${typeof payload}.`);
  }

  return payload;
}

const CanaryLedgerRowSchema = z
  .object({
    date: z.string().min(1),
    description: z.string().nullable().optional(),
    unitsDescription: z.string().nullable().optional(),
    unitsDescriptionIncl: z.string().nullable().optional(),
    debit: z.string().nullable().optional(),
    debitIncl: z.string().nullable().optional(),
    credit: z.string().nullable().optional(),
    creditIncl: z.string().nullable().optional(),
    balance: z.string().nullable().optional(),
    balanceIncl: z.string().nullable().optional()
  })
  .passthrough();

// Canary-only contract inspection. Returns counts, never ledger rows, so the
// scheduled job cannot accidentally persist or expose account transactions.
export async function checkLiveMopayLedgerContract(params: LiveMopayLedgerRequest): Promise<{
  rowCount: number;
  parseableRowCount: number;
}> {
  const payload = await fetchLiveMopayLedgerPayload(params);
  if (payload.length === 0) {
    throw new Error("Recent ledger response was empty; parser contract could not be exercised.");
  }

  let parseableRowCount = 0;
  for (const item of payload) {
    const parsed = CanaryLedgerRowSchema.safeParse(item);
    if (!parsed.success) {
      throw new Error("Recent ledger row is missing required contract fields.");
    }
    if (normalizeLedgerRow(parsed.data as LedgerApiRow)) {
      parseableRowCount += 1;
    }
  }

  if (parseableRowCount === 0) {
    throw new Error("Recent ledger rows no longer contain a structure understood by the parser.");
  }

  return { rowCount: payload.length, parseableRowCount };
}

export function currentNewinmeterLocalYear() {
  return localYearFormatter.format(new Date());
}
