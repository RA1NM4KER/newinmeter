import "server-only";

import { getNewinmeterCanaryConfig } from "../env";
import {
  checkLiveMopayLedgerContract,
  discoverLiveMopayAccounts,
  loginWithLiveMopayCredentials,
  refreshLiveMopaySession,
  type LiveMopayAccountCandidate,
  type LiveMopaySession
} from "../newinmeter/web";

export type CanaryStep = "configuration" | "login" | "refresh" | "discovery" | "ledger";

export class CanaryContractError extends Error {
  constructor(
    public readonly step: CanaryStep,
    message: string
  ) {
    super(message);
    this.name = "CanaryContractError";
  }
}

type CanaryDependencies = {
  getConfig: typeof getNewinmeterCanaryConfig;
  login: typeof loginWithLiveMopayCredentials;
  refresh: typeof refreshLiveMopaySession;
  discover: typeof discoverLiveMopayAccounts;
  checkLedger: typeof checkLiveMopayLedgerContract;
  now: () => Date;
};

const defaultDependencies: CanaryDependencies = {
  getConfig: getNewinmeterCanaryConfig,
  login: loginWithLiveMopayCredentials,
  refresh: refreshLiveMopaySession,
  discover: discoverLiveMopayAccounts,
  checkLedger: checkLiveMopayLedgerContract,
  now: () => new Date()
};

function safeRequestFailure(step: CanaryStep, error: unknown): CanaryContractError {
  if (error instanceof CanaryContractError) return error;
  const message = error instanceof Error ? error.message : "Request failed.";
  const status = message.match(/(?:failed with|failed \()\s*(\d{3})/)?.[1];
  if (status) return new CanaryContractError(step, `${step} request returned HTTP ${status}.`);
  if (/fetch failed|network|timeout|timed out/i.test(message)) {
    return new CanaryContractError(step, `${step} request could not reach the upstream service.`);
  }
  return new CanaryContractError(step, `${step} response did not satisfy the required contract.`);
}

function validateSession(session: LiveMopaySession, step: "login" | "refresh") {
  if (
    !session.idToken ||
    !session.refreshToken ||
    !session.expiresAt ||
    !Number.isFinite(Date.parse(session.expiresAt))
  ) {
    throw new CanaryContractError(step, `${step} response is missing token or expiry fields.`);
  }
}

function recentStartDate(now: Date): string {
  const start = new Date(now);
  start.setUTCDate(start.getUTCDate() - 7);
  return start.toISOString().slice(0, 10);
}

function selectCanaryAccount(candidates: LiveMopayAccountCandidate[], accountId: string) {
  const candidate = candidates.find((item) => item.accountId === accountId);
  if (!candidate?.companyId || !candidate.propertyId) {
    throw new CanaryContractError(
      "discovery",
      "Canary account discovery no longer returns the required account, company, and property identity fields."
    );
  }
  return candidate;
}

export async function runLiveMopayContractCanary(
  overrides: Partial<CanaryDependencies> = {}
): Promise<{ checkedAt: string; ledgerRows: number; parseableLedgerRows: number }> {
  const deps = { ...defaultDependencies, ...overrides };
  let config: ReturnType<typeof getNewinmeterCanaryConfig>;
  try {
    config = deps.getConfig();
  } catch {
    throw new CanaryContractError("configuration", "Canary server environment is not configured.");
  }

  let loginSession: LiveMopaySession;
  try {
    loginSession = await deps.login(config.email, config.password);
    validateSession(loginSession, "login");
  } catch (error) {
    throw safeRequestFailure("login", error);
  }

  let refreshedSession: LiveMopaySession;
  try {
    refreshedSession = await deps.refresh(loginSession.refreshToken);
    validateSession(refreshedSession, "refresh");
  } catch (error) {
    throw safeRequestFailure("refresh", error);
  }

  let candidate: LiveMopayAccountCandidate;
  try {
    const candidates = await deps.discover(refreshedSession.idToken);
    candidate = selectCanaryAccount(candidates, config.accountId);
  } catch (error) {
    throw safeRequestFailure("discovery", error);
  }

  try {
    const ledger = await deps.checkLedger({
      idToken: refreshedSession.idToken,
      accountId: candidate.accountId,
      companyId: candidate.companyId,
      propertyId: candidate.propertyId,
      startDate: recentStartDate(deps.now())
    });
    return {
      checkedAt: deps.now().toISOString(),
      ledgerRows: ledger.rowCount,
      parseableLedgerRows: ledger.parseableRowCount
    };
  } catch (error) {
    throw safeRequestFailure("ledger", error);
  }
}
