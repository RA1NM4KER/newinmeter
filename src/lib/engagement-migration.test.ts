import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(join(process.cwd(), "supabase/migrations/20260826082540_engagement_tracking.sql"), "utf8");

describe("engagement migration security", () => {
  it("enforces one foreground row per user and day with owner-only RLS", () => {
    expect(sql).toContain("primary key (user_id, activity_date)");
    expect(sql).toContain("on conflict (user_id, activity_date)");
    expect(sql).toContain("do update set last_seen_at = excluded.last_seen_at");
    expect(sql).toContain("alter table public.user_activity_days enable row level security");
    expect(sql).toContain("(select auth.uid()) = user_id");
    expect(sql).toContain("grant execute on function public.record_user_activity() to authenticated");
  });

  it("prevents service-role background work from writing human activity", () => {
    expect(sql).toContain("revoke all on public.user_activity_days from anon, authenticated, service_role");
    expect(sql).toContain("grant select on public.user_activity_days to service_role");
    expect(sql).not.toMatch(/grant\s+(?:insert|update|all)[^;]*user_activity_days[^;]*service_role/i);
    expect(sql).toContain("revoke all on function public.record_user_activity() from public, anon, service_role");
  });

  it("keeps AI tracking aggregate-only and inaccessible to normal users", () => {
    expect(sql).toContain("constraint user_feature_usage_feature_check check (feature in ('ai'))");
    expect(sql).toContain("revoke all on public.user_feature_usage from anon, authenticated");
    expect(sql).toContain(
      "revoke all on function public.record_user_feature_usage(uuid, text) from public, anon, authenticated"
    );
    expect(sql).not.toMatch(
      /\b(prompt_text|question_text|response_body|route_history|ip_address|device_fingerprint)\b/i
    );
  });
});
