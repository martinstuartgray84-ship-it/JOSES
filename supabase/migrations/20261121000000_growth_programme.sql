-- Growth Console: the programme office. Actions, decisions, big-bet charters,
-- meeting notes and the turn-away tally. Same rules as the other growth
-- tables: venue_id on every row, row-level security, display names only.

create table growth_actions (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references venues on delete cascade,
  -- Short reference such as A07; unique per venue so the starter pack loads once.
  ref text,
  owner text not null,
  task text not null,
  due date,
  status text not null default 'open' check (status in ('open', 'done', 'dropped')),
  notes text,
  done_on date,
  created_at timestamptz not null default now(),
  unique (venue_id, ref)
);
create index growth_actions_venue on growth_actions (venue_id, status, due);

create table growth_decisions (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references venues on delete cascade,
  item text not null,
  decision text,
  decided_by text,
  decided_on date,
  notes text,
  sort int not null default 0,
  created_at timestamptz not null default now(),
  unique (venue_id, item)
);

create table growth_bets (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references venues on delete cascade,
  name text not null,
  yearly_value numeric(12,2),
  sponsor text,
  lead text,
  measures text,
  stop_rule text,
  notes text,
  status text not null default 'active' check (status in ('active', 'parked', 'stopped')),
  -- Three gates: [{"title": "Allowed and feasible", "test": "...", "status": "pending|passed|failed", "decided_on": "2027-01-15"}]
  gates jsonb not null default '[]',
  sort int not null default 0,
  created_at timestamptz not null default now(),
  unique (venue_id, name)
);

create table growth_meetings (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references venues on delete cascade,
  kind text not null check (kind in ('mobilisation', 'weekly_review', 'huddle', 'monthly', 'quarterly', 'other')),
  held_on date not null,
  title text not null,
  attendees text,
  notes text not null default '',
  created_at timestamptz not null default now()
);
create index growth_meetings_venue on growth_meetings (venue_id, held_on desc);

create table growth_turnaways (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references venues on delete cascade,
  turned_at timestamp not null,           -- wall-clock, like every growth timestamp
  party_size int not null check (party_size between 1 and 500),
  reason text not null,
  offered_alternative text,
  created_at timestamptz not null default now()
);
create index growth_turnaways_venue on growth_turnaways (venue_id, turned_at desc);

-- Everyone at the venue reads; managers run the programme. Hosts work the
-- door and the gains board, so they can log turn-aways and tick their own actions.
do $$
declare t text;
begin
  foreach t in array array['growth_actions', 'growth_decisions', 'growth_bets', 'growth_meetings', 'growth_turnaways'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for select to authenticated using (is_venue_member(venue_id, ''viewer''))', t || '_read', t);
    execute format('create policy %I on %I for all to authenticated using (is_venue_member(venue_id, ''manager'')) with check (is_venue_member(venue_id, ''manager''))', t || '_manage', t);
  end loop;
end $$;
create policy growth_turnaways_log on growth_turnaways for insert to authenticated with check (is_venue_member(venue_id, 'host'));
create policy growth_actions_tick on growth_actions for update to authenticated
  using (is_venue_member(venue_id, 'host')) with check (is_venue_member(venue_id, 'host'));
