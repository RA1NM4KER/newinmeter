import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(process.cwd(), "supabase/migrations/20260916121835_inactive_user_cold_storage.sql"),
  "utf8"
).toLowerCase();

describe("inactive-user cold-storage migration", () => {
  it("uses a hard 45-day minimum and a conservative no-foreground fallback", () => {
    expect(sql).toContain("p_inactive_for < interval '45 days'");
    expect(sql).toContain("max(d.last_seen_at)");
    expect(sql).toContain("coalesce(activity.last_seen_at, greatest(u.last_sign_in_at, c.connected_at))");
  });

  it.each([
    "c.is_demo = false",
    "r.role = 'admin'",
    "r.engagement_excluded",
    "not c.alerts_enabled",
    "ar.enabled",
    "md.enabled",
    "c.sync_claimed_at is null",
    "cr.status = 'running'"
  ])("contains eligibility exemption %s", (predicate) => {
    expect(sql).toContain(predicate);
  });

  it("claims with skip locked and gates all ordinary auto-sync to warm data", () => {
    expect(sql).toContain("for update of c skip locked");
    expect(sql).toContain("set data_state = 'hibernating'");
    expect(sql).toMatch(/claim_due_auto_sync_connections[\s\S]*?c\.data_state = 'warm'/);
  });

  it("reclaims hibernating work after an error clears the lease or after the lease expires", () => {
    expect(sql).toContain("c.hibernation_claimed_at is null");
    expect(sql).toContain("c.hibernation_claimed_at < now() - p_claim_ttl");
    expect(sql).toContain("set hibernation_error = left(p_error, 500), hibernation_claimed_at = null");
  });

  it("serializes capture start with hibernation without holding locks around HTTP", () => {
    expect(sql).toContain("create or replace function public.start_capture_run");
    expect(sql).toContain("for update;");
    expect(sql).toContain("v_state <> 'restoring'");
    expect(sql).toContain("v_state <> 'warm'");
    expect(sql).not.toContain("http_post");
  });

  it("deletes only approved reproducible detail in bounded batches", () => {
    const deletes = Array.from(sql.matchAll(/delete from public\.([a-z_]+)/g)).map((match) => match[1]);
    expect(new Set(deletes)).toEqual(new Set(["energy_rows", "energy_hourly_rollups", "energy_interval_rollups"]));
    expect(sql).toContain("limit v_limit");
    expect(sql).toContain("set local statement_timeout = '20s'");
    expect(sql).not.toMatch(/delete from public\.(usage_activities|energy_day_rollups|dashboard_summary|alert_rules)/);
  });

  it("keeps destructive functions service-role-only while owner restore is non-destructive", () => {
    for (const signature of [
      "claim_cold_storage_candidates(integer, interval, interval)",
      "purge_cold_storage_batch(uuid, integer)",
      "complete_connection_hibernation(uuid)"
    ]) {
      expect(sql).toContain(`revoke all on function public.${signature} from public, anon, authenticated`);
      expect(sql).toContain(`grant execute on function public.${signature} to service_role`);
    }
    expect(sql).toContain("grant execute on function public.request_livemopay_restore() to authenticated");
    expect(sql).toContain("where c.user_id = auth.uid()");
  });

  it("makes restore claims idempotent and preserves retry/failure states", () => {
    expect(sql).toContain("if v_connection.data_state = 'restoring'");
    expect(sql).toContain("false");
    expect(sql).toContain("data_state = 'restore_failed'");
    expect(sql).toContain("data_state = 'warm'");
  });
});
