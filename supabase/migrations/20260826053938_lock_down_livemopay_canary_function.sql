-- Supabase's project default privileges grant EXECUTE on newly-created
-- functions directly to anon and authenticated. Revoking from PUBLIC in the
-- diagnostics migration therefore was not sufficient for this SECURITY
-- DEFINER cron dispatcher. Keep it callable only by trusted database roles.
revoke execute on function public.trigger_newinmeter_livemopay_canary()
  from anon, authenticated;
