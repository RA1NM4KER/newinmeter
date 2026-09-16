-- Split sign_in_started/sign_in_completed by auth method (google vs email)
-- so the onboarding funnel can show which path actually converts, instead
-- of a single blended count. See src/lib/funnel.ts.

alter table public.onboarding_funnel_daily drop constraint onboarding_funnel_event_type_check;

alter table public.onboarding_funnel_daily add constraint onboarding_funnel_event_type_check check (event_type in (
  'login_page_viewed',
  'public_demo_started',
  'demo_reached',
  'sign_in_started_google',
  'sign_in_started_email',
  'sign_in_completed_google',
  'sign_in_completed_email',
  'connect_screen_viewed',
  'connect_attempted',
  'connect_invalid_credentials',
  'connect_succeeded',
  'initial_sync_succeeded',
  'initial_sync_failed'
));
