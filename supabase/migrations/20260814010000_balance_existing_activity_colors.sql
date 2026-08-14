with ranked_activities as (
  select
    id,
    row_number() over (
      partition by connection_id
      order by starts_at, created_at, id
    ) - 1 as color_index
  from public.usage_activities
)
update public.usage_activities activity
set color = (array[
  '#0f766e',
  '#2563eb',
  '#c2410c',
  '#7c3aed',
  '#db2777',
  '#65a30d'
])[1 + mod(ranked.color_index, 6)::integer]
from ranked_activities ranked
where activity.id = ranked.id;
