-- The programme's own name, shown across the programme side ("Every Hour" is
-- the plan's working name; the team picks its own at the mobilisation meeting).
alter table growth_settings add column programme_name text not null default 'Every Hour'
  check (length(btrim(programme_name)) between 1 and 60);
