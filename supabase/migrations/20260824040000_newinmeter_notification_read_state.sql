-- Notification Centre (header bell) read/unread state, built on top of the
-- existing Alerts v1 alert_events table -- no second notifications table.
--
-- notification_sent_at (existing) = external push delivery attempt/success.
-- read_at (new)                   = user has seen/opened the in-app
--                                    notification. Deliberately separate
--                                    concepts, never conflated.
--
-- No RLS policy changes and no new grantable Postgres function here. The
-- existing alert_events RLS is select-only for authenticated (see
-- 20260824020000) -- that stays exactly as-is, so alert_events' system-
-- generated integrity (trigger_value, threshold_value, resolved_at,
-- connection_id, alert_rule_id) remains fully protected from any
-- authenticated write, direct or otherwise. Marking a notification read
-- goes through the existing service-role + resolved-connection_id pattern
-- already used by every other alert_events/alert_rules write in
-- src/lib/newinmeter/alerts.ts (see markNotificationRead/
-- markAllNotificationsRead), not a new SECURITY DEFINER function -- this
-- was a deliberate choice after the auto-sync deployment turned up a real
-- default-privilege grant leak on a function that was only ever meant to
-- be reachable server-side. Not introducing a new grantable function here
-- removes that entire class of risk for this feature.
alter table public.alert_events
  add column read_at timestamptz;

-- Supports the unread-count / unread-list query directly (connection_id
-- equality + read_at IS NULL) -- same partial-index shape as the existing
-- alert_events_active_per_rule_idx.
create index alert_events_unread_idx
  on public.alert_events (connection_id)
  where read_at is null;
