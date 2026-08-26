alter table public.energy_rows
  add column tariff_band text;

comment on column public.energy_rows.tariff_band is
  'NewinMeter-derived tariff band. Raw LiveMopay charge_label remains unchanged.';

notify pgrst, 'reload schema';
