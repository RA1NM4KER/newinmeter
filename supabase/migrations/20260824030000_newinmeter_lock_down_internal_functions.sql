-- Security fix discovered during Alerts v1 / auto-sync deployment
-- verification (production advisor + direct has_function_privilege checks):
-- `revoke all on function ... from public` does NOT strip anon/authenticated's
-- ability to execute a function on this project, because Supabase's project
-- bootstrap grants EXECUTE on newly-created functions to anon/authenticated
-- directly (ALTER DEFAULT PRIVILEGES), not via the PUBLIC pseudo-role --
-- revoking from PUBLIC only removes the "everyone" grant, not that separate
-- explicit one. Confirmed via has_function_privilege() that both
-- trigger_newinmeter_auto_sync() (flagged by the advisor) and
-- claim_due_auto_sync_connections()/finish_capture_run() (not flagged by
-- this particular scan, but equally exposed) were callable by anon and
-- authenticated via /rest/v1/rpc/<function> despite each migration's own
-- "service-role only" comment.
--
-- Concrete impact before this fix: any signed-in user (claim_due_auto_sync_
-- connections has no auth.uid() check of its own -- it's meant to be
-- reached only via the trusted service-role worker) could call
-- claim_due_auto_sync_connections() directly and receive OTHER users'
-- encrypted refresh-token ciphertext/iv/authTag in the RPC response, claim
-- their due connections out of turn, or call finish_capture_run() to
-- fabricate a capture run's outcome. trigger_newinmeter_auto_sync() being
-- callable let anyone force an out-of-cadence worker invocation.
--
-- Fix: revoke EXECUTE from anon and authenticated by name (not just
-- PUBLIC) on each of these three internal, server-to-server-only
-- functions. service_role keeps EXECUTE (re-asserted explicitly, though it
-- was never actually at risk here).

revoke execute on function public.claim_due_auto_sync_connections(integer, interval) from anon, authenticated;
grant execute on function public.claim_due_auto_sync_connections(integer, interval) to service_role;

revoke execute on function public.trigger_newinmeter_auto_sync() from anon, authenticated;

revoke execute on function public.finish_capture_run(uuid, text, integer, text) from anon, authenticated;
grant execute on function public.finish_capture_run(uuid, text, integer, text) to service_role;
