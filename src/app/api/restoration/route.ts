import { NextResponse } from "next/server";
import { getAuthenticatedSession } from "@/lib/auth/session";
import { limitUserRequest } from "@/lib/rate-limit";
import {
  completeConnectionRestore,
  failConnectionRestore,
  getConnectionRowForUser,
  getDecryptedRefreshToken,
  markConnectionAuthError,
  markConnectionSyncOutcome,
  replaceConnectionRefreshToken,
  requestConnectionRestore
} from "@/lib/newinmeter/connection";
import { runLivemopaySync, SyncAlreadyRunningError } from "@/lib/newinmeter/sync";
import { LiveMopayRefreshTokenInvalidError } from "@/lib/newinmeter/web";
import { TokenDecryptionError } from "@/lib/token-encryption";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  const session = await getAuthenticatedSession();
  if (!session) return NextResponse.json({ message: "Authentication required." }, { status: 401 });
  const rate = await limitUserRequest(session.userId, "restoration-status");
  if (rate.response) return rate.response;

  const connection = await getConnectionRowForUser(session.userId);
  if (!connection) return NextResponse.json({ message: "Connection not found." }, { status: 404 });
  return NextResponse.json(
    {
      dataState: connection.data_state,
      error: connection.restore_error,
      reconnectRequired: connection.status !== "connected" || !connection.refresh_token_ciphertext
    },
    { headers: rate.headers }
  );
}

export async function POST() {
  const session = await getAuthenticatedSession();
  if (!session) return NextResponse.json({ message: "Authentication required." }, { status: 401 });
  const rate = await limitUserRequest(session.userId, "restoration", "sync");
  if (rate.response) return rate.response;

  const request = await requestConnectionRestore(session.accessToken);
  if (!request) return NextResponse.json({ message: "Connection not found." }, { status: 404 });
  if (!request.shouldStart) {
    return NextResponse.json({ dataState: request.dataState, started: false }, { status: 202, headers: rate.headers });
  }

  const connection = await getConnectionRowForUser(session.userId);
  if (
    !connection ||
    connection.id !== request.connectionId ||
    !connection.account_id ||
    !connection.company_id ||
    !connection.property_id
  ) {
    await failConnectionRestore(request.connectionId, "LiveMopay account details are incomplete.").catch(() => {});
    return NextResponse.json(
      { message: "Reconnect your LiveMopay account.", reconnectRequired: true },
      { status: 409 }
    );
  }

  try {
    const refreshToken = getDecryptedRefreshToken(connection);
    await runLivemopaySync({
      connectionId: connection.id,
      accountId: connection.account_id,
      companyId: connection.company_id,
      propertyId: connection.property_id,
      refreshToken,
      mode: "restore",
      trigger: "restore",
      onRefreshTokenRotated: (nextToken) => replaceConnectionRefreshToken(connection.id, nextToken)
    });
    await markConnectionSyncOutcome(connection.id, null);
    await completeConnectionRestore(connection.id);
    return NextResponse.json({ dataState: "warm", started: true }, { headers: rate.headers });
  } catch (error) {
    if (error instanceof SyncAlreadyRunningError) {
      return NextResponse.json({ dataState: "restoring", started: false }, { status: 202, headers: rate.headers });
    }
    if (error instanceof TokenDecryptionError || error instanceof LiveMopayRefreshTokenInvalidError) {
      await markConnectionAuthError(connection.id).catch(() => {});
      return NextResponse.json(
        { message: "Your LiveMopay connection expired. Reconnect to restore your data.", reconnectRequired: true },
        { status: 409, headers: rate.headers }
      );
    }

    const message = error instanceof Error ? error.message : "Restoration failed.";
    await failConnectionRestore(connection.id, message).catch(() => {});
    return NextResponse.json(
      { message: "Restoration failed. Please retry.", retryable: true },
      { status: 500, headers: rate.headers }
    );
  }
}
