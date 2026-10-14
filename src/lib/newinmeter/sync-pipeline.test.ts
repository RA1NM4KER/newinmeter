import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchWithRequestBudget, withRequestBudget } from "../request-budget";
const web = vi.hoisted(() => ({ session: vi.fn(), ledger: vi.fn() }));
vi.mock("../env", async () => {
  const actual = await vi.importActual<typeof import("../env")>("../env");
  return { ...actual, getSupabaseUrl: () => "https://database.example", getSupabaseServiceRoleKey: () => "test-key" };
});
vi.mock("./web", async () => {
  const actual = await vi.importActual<typeof import("./web")>("./web");
  return { ...actual, refreshLiveMopaySession: web.session, fetchLiveMopayLedger: web.ledger };
});
import { runLivemopaySync } from "./sync";
import type { NewinmeterCsvRow } from "./web";
const params = {
  connectionId: "conn-a",
  accountId: "account-a",
  companyId: "company-a",
  propertyId: "property-a",
  refreshToken: "secret-refresh-token",
  mode: "incremental" as const,
  trigger: "auto" as const,
  onRefreshTokenRotated: vi.fn()
};
let state: string;
let batches: number;
let mode: "slow" | "stall" | "lost-finalization";
let patches: Record<string, unknown>[];
let startedRunId: string;
function rows(count: number): NewinmeterCsvRow[] {
  return Array.from({ length: count }, (_, i) => ({
    capture_dt: "14/10/2026 15:00",
    source_ts: "2026-10-14T12:45:00Z",
    charge_label: "Energy Charge: ",
    period_dt: new Date(Date.UTC(2026, 6, 16) + i * 14 * 60000).toISOString().replace("T", " ").slice(0, 16),
    kwh: "1",
    water_kl: "0",
    tariff: "2",
    cost: "2",
    balance: String(10000 - i)
  }));
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-14T13:00:00Z"));
  vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException("Request timed out.", "TimeoutError")), ms);
    return controller.signal;
  });
  state = "running";
  batches = 0;
  patches = [];
  mode = "slow";
  web.session.mockResolvedValue({ idToken: "id-token", refreshToken: params.refreshToken });
  web.ledger.mockImplementation(async () => {
    await fetchWithRequestBudget("https://ledger.example/read");
    return rows(9000);
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input, init) => {
      const url = String(input);
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      if (url.includes("start_capture_run")) {
        startedRunId = body.p_run_id;
        return Response.json([{ id: startedRunId, status: state }]);
      }
      if (url.includes("select=reporting_model"))
        return Response.json([{ sync_schedule_mode: "adaptive", last_reconciled_at: null, auto_sync_enabled: true }]);
      if (url.includes("select=tariff_profile")) return Response.json([{ tariff_profile: null }]);
      if (url.includes("upsert_changed_energy_rows")) {
        batches++;
        if (mode === "stall" && batches > 1)
          return new Promise((_resolve, reject) =>
            init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true })
          );
        if (mode === "slow")
          return new Promise((resolve) => setTimeout(() => resolve(Response.json(body.p_rows.length)), 4000));
        return Response.json(body.p_rows.length);
      }
      if (url.includes("finish_capture_run")) {
        if (state === "running") state = body.p_status;
        if (mode === "lost-finalization" && body.p_status === "success") throw new Error("network response lost");
        return Response.json(null);
      }
      if (url.includes("capture_runs?select=id,status")) return Response.json([{ id: startedRunId, status: state }]);
      if (init?.method === "PATCH") patches.push(body);
      return Response.json({});
    })
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe("bounded reconciliation pipeline", () => {
  it("completes a 90-day reconciliation lasting longer than the old 60-second worker", async () => {
    const result = withRequestBudget(110000, () => runLivemopaySync(params));
    await vi.advanceTimersByTimeAsync(75000);
    expect(await result).toMatchObject({ rowsFetched: 9000, rowsSynced: 9000 });
    expect(batches).toBe(18);
    expect(state).toBe("success");
    expect(patches.some((p) => typeof p.last_reconciled_at === "string")).toBe(true);
    expect(web.ledger).toHaveBeenCalledWith(expect.objectContaining({ startDate: "2026-07-16" }));
  });
  it("aborts stalled batch requests, finalizes failure, and does not advance reconciliation", async () => {
    mode = "stall";
    const result = withRequestBudget(110000, () => runLivemopaySync(params)).catch((e) => e);
    await vi.advanceTimersByTimeAsync(70000);
    expect(await result).toMatchObject({ name: "TimeoutError" });
    expect(state).toBe("failed");
    expect(patches.some((p) => "last_reconciled_at" in p)).toBe(false);
    expect(batches).toBe(4); // One completed batch, three bounded idempotent attempts.
  });
  it("does not turn committed success into failure when finalization's response is lost", async () => {
    mode = "lost-finalization";
    const result = await runLivemopaySync(params);
    expect(result.rowsFetched).toBe(9000);
    expect(state).toBe("success");
    const finalizations = vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes("finish_capture_run"));
    expect(finalizations).toHaveLength(1);
  });
});
