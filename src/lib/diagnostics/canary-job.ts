import "server-only";

import { CanaryContractError, runLiveMopayContractCanary } from "./canary";
import { sendOperationalPushToAdmins } from "./notifications";
import { evaluateSchedulerWatchdog } from "./operations";
import { openSystemIncident, recordSystemEvent, recordSystemHealthCheck, resolveSystemIncident } from "./store";

type CanaryRun = typeof runLiveMopayContractCanary;

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function toCanaryError(error: unknown) {
  return error instanceof CanaryContractError
    ? error
    : new CanaryContractError("configuration", "Canary check failed safely before a contract step completed.");
}

async function evaluateSchedulerWatchdogSafely(): Promise<void> {
  try {
    await evaluateSchedulerWatchdog();
  } catch {
    // Scheduler diagnostics must not turn a completed upstream contract
    // check into a retry (and therefore an extra LiveMopay request).
    console.error("newinmeter_scheduler_watchdog_failed");
  }
}

async function sendCanaryFailurePushSafely(eventId: string): Promise<void> {
  try {
    await sendOperationalPushToAdmins({
      title: "LiveMopay integration check failed",
      body: "NewinMeter's production dependency contract failed after retry.",
      eventId,
      tag: "newinmeter-system-livemopay-canary"
    });
  } catch {
    // The critical event/state is authoritative even if push itself is
    // unavailable. Do not hide the canary result behind a push error.
    console.error("newinmeter_canary_operational_push_failed");
  }
}

export async function executeDailyCanary(
  options: {
    run?: CanaryRun;
    retryDelayMs?: number;
    delay?: (milliseconds: number) => Promise<void>;
  } = {}
): Promise<{ status: "healthy" | "warning" | "critical"; attempts: 1 | 2; failedStep?: string }> {
  const run = options.run ?? runLiveMopayContractCanary;
  const delay = options.delay ?? wait;
  let firstError: CanaryContractError;

  try {
    const result = await run();
    await recordSystemHealthCheck({
      component: "livemopay:canary",
      status: "healthy",
      succeeded: true,
      details: { attempts: 1, ledgerRows: result.ledgerRows, parseableLedgerRows: result.parseableLedgerRows }
    });
    await resolveSystemIncident("livemopay:canary", {
      category: "livemopay",
      eventType: "livemopay_canary_recovered",
      message: "The LiveMopay production dependency contract recovered."
    });
    await evaluateSchedulerWatchdogSafely();
    return { status: "healthy", attempts: 1 };
  } catch (error) {
    firstError = toCanaryError(error);
  }

  await delay(options.retryDelayMs ?? 5_000);

  try {
    const result = await run();
    await recordSystemHealthCheck({
      component: "livemopay:canary",
      status: "warning",
      succeeded: true,
      details: {
        attempts: 2,
        firstFailedStep: firstError.step,
        ledgerRows: result.ledgerRows,
        parseableLedgerRows: result.parseableLedgerRows
      }
    });
    await recordSystemEvent({
      severity: "warning",
      category: "livemopay",
      eventType: "livemopay_canary_retry_recovered",
      message: "The LiveMopay contract check failed once and recovered on its bounded retry.",
      metadata: { firstFailedStep: firstError.step },
      resolvedAt: new Date().toISOString()
    });
    await resolveSystemIncident("livemopay:canary", {
      category: "livemopay",
      eventType: "livemopay_canary_recovered",
      message: "The LiveMopay production dependency contract recovered."
    });
    await evaluateSchedulerWatchdogSafely();
    return { status: "warning", attempts: 2, failedStep: firstError.step };
  } catch (error) {
    const finalError = toCanaryError(error);
    await recordSystemHealthCheck({
      component: "livemopay:canary",
      status: "critical",
      succeeded: false,
      details: { attempts: 2, failedStep: finalError.step }
    });
    const incident = await openSystemIncident({
      severity: "critical",
      category: "livemopay",
      eventType: "livemopay_canary_failed",
      message: `The LiveMopay ${finalError.step} contract check failed after one retry.`,
      metadata: { attempts: 2, failedStep: finalError.step },
      incidentKey: "livemopay:canary"
    });
    if (incident.created || incident.escalated) {
      await sendCanaryFailurePushSafely(incident.event.id);
    }
    await evaluateSchedulerWatchdogSafely();
    return { status: "critical", attempts: 2, failedStep: finalError.step };
  }
}
