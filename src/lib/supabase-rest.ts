import "server-only";

import { getSupabaseAnonKey, getSupabaseServiceRoleKey, getSupabaseUrl } from "./env";

const PAGE_SIZE = 1000;

function restUrl() {
  return `${getSupabaseUrl().replace(/\/$/, "")}/rest/v1`;
}

async function readJsonOrThrow<T>(response: Response, context: string): Promise<T> {
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`${context} failed (${response.status}): ${text}`);
  }

  return (text ? JSON.parse(text) : null) as T;
}

// ---- Authenticated access: forwards the caller's own Supabase access token,
// so PostgREST evaluates row-level security as that user. This is the
// default path for every dashboard/table/export/assistant read. ----

export async function authenticatedSupabaseResponse(path: string, accessToken: string, init?: RequestInit) {
  const response = await fetch(`${restUrl()}${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      apikey: getSupabaseAnonKey(),
      Authorization: `Bearer ${accessToken}`,
      ...(init?.headers ?? {})
    }
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Supabase request failed (${response.status}): ${detail}`);
  }

  return response;
}

export async function authenticatedSupabaseFetch<T>(path: string, accessToken: string, init?: RequestInit): Promise<T> {
  const response = await authenticatedSupabaseResponse(path, accessToken, init);
  return (await response.json()) as Promise<T>;
}

export async function authenticatedSupabaseFetchAllPages<T>(
  path: string,
  accessToken: string,
  init?: RequestInit
): Promise<T[]> {
  const rows: T[] = [];

  for (let offset = 0; ; offset += PAGE_SIZE) {
    const page = await authenticatedSupabaseFetch<T[]>(path, accessToken, {
      ...init,
      headers: {
        ...(init?.headers ?? {}),
        Range: `${offset}-${offset + PAGE_SIZE - 1}`
      }
    });

    rows.push(...page);

    if (page.length < PAGE_SIZE) {
      break;
    }
  }

  return rows;
}

// ---- Admin access: service-role key, bypasses RLS entirely. Reserved for
// sync ingestion writes and LiveMopay connection persistence, both of which
// need to resolve or establish ownership before any RLS policy could apply.
// Every caller of this must filter by an explicitly-resolved user_id or
// connection_id itself -- there is no RLS safety net here. ----

export async function adminSupabaseRawResponse(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
  prefer?: string,
  range?: string
): Promise<Response> {
  const key = getSupabaseServiceRoleKey();

  return fetch(`${restUrl()}${path}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(prefer ? { Prefer: prefer } : {}),
      ...(range ? { Range: range } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store"
  });
}

export async function adminSupabaseRequest<T>(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
  prefer?: string
): Promise<T> {
  const response = await adminSupabaseRawResponse(method, path, body, prefer);
  return readJsonOrThrow<T>(response, `${method} ${path}`);
}

export async function adminSupabaseFetch<T>(path: string): Promise<T> {
  return adminSupabaseRequest<T>("GET", path);
}

export async function adminSupabaseFetchAllPages<T>(path: string): Promise<T[]> {
  const rows: T[] = [];

  for (let offset = 0; ; offset += PAGE_SIZE) {
    const response = await adminSupabaseRawResponse(
      "GET",
      path,
      undefined,
      undefined,
      `${offset}-${offset + PAGE_SIZE - 1}`
    );
    const page = await readJsonOrThrow<T[]>(response, `GET ${path}`);
    rows.push(...page);

    if (page.length < PAGE_SIZE) break;
  }

  return rows;
}

// Exact row count via PostgREST's Content-Range header, without pulling any
// rows -- used by scripts/backfill-legacy-owner.ts to print before/after
// counts.
export async function adminSupabaseCount(path: string): Promise<number> {
  const response = await adminSupabaseRawResponse("GET", path, undefined, "count=exact");

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`GET ${path} failed (${response.status}): ${detail}`);
  }

  const contentRange = response.headers.get("content-range");
  const total = contentRange?.split("/")[1];
  const parsed = total ? Number(total) : NaN;

  return Number.isFinite(parsed) ? parsed : 0;
}
