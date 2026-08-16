alter table public.usage_activities
  add constraint usage_activities_max_duration
  check (ends_at <= starts_at + interval '1 day')
  not valid;
