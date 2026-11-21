-- Growth Console: till and booking exports, stored summaries, and the
-- programme (ideas, tests, gains, scorecards, bridge, events).
-- Rules (docs/growth): every table carries venue_id and is protected by
-- row-level security; timestamps are the venue's wall-clock time (timestamp
-- WITHOUT time zone, never converted); money is net pounds with 2 decimals;
-- people appear as a display name only.

create table growth_settings (
  venue_id uuid primary key references venues on delete cascade,
  seats int not null default 60 check (seats > 0),
  bar_seats int check (bar_seats >= 0),
  -- {"mon": null, "tue": ["17:00", "23:00"], ...}; null = closed.
  trading_hours jsonb not null default '{}',
  -- Lowest role that may see figures for individual servers.
  server_figures_min_role venue_role not null default 'manager',
  -- [{"name": "Bar", "captain": "Sofia"}, ...]
  gain_areas jsonb not null default '[]',
  -- Who receives the Monday scorecard.
  scorecard_emails text[] not null default '{}',
  -- Bumped on every import, so cached models know to reload.
  data_version int not null default 0,
  updated_at timestamptz not null default now()
);

create type growth_file_kind as enum ('checks', 'items', 'bookings');

create table growth_column_maps (
  venue_id uuid not null references venues on delete cascade,
  kind growth_file_kind not null,
  -- {"check_id": "Check ID", "opened_at": "Opened At", ...}
  mapping jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (venue_id, kind)
);

create table growth_imports (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references venues on delete cascade,
  kind growth_file_kind not null,
  filename text not null,
  status text not null default 'loading' check (status in ('loading', 'loaded', 'failed')),
  rows_read int not null default 0,
  -- Rows written, new or replaced.
  rows_loaded int not null default 0,
  -- Of those, rows that were not there before.
  rows_new int not null default 0,
  rows_skipped int not null default 0,
  first_day date,
  last_day date,
  -- {"reasons": {"No check_id": 3}, "examples": [{"row": 12, "reason": "..."}]}
  report jsonb not null default '{}',
  sample boolean not null default false,
  uploaded_by text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index growth_imports_venue on growth_imports (venue_id, created_at desc);

create table growth_checks (
  venue_id uuid not null references venues on delete cascade,
  check_id text not null,
  opened_at timestamp not null,
  closed_at timestamp,
  -- opened_at shifted back 5 hours: a trading day runs 05:00 to 04:59.
  trading_day date not null,
  table_ref text not null default '',
  covers numeric(8,2) not null default 1 check (covers > 0),
  server text not null default 'Unknown',
  -- Null when the till export has no total: the engine sums the item lines.
  net_total numeric(10,2),
  import_id uuid references growth_imports on delete set null,
  primary key (venue_id, check_id)
);
create index growth_checks_day on growth_checks (venue_id, trading_day);

create table growth_items (
  venue_id uuid not null,
  check_id text not null,
  -- Sequence of the line within its check, in file order.
  line_no int not null,
  item text not null,
  category text not null default 'Other',
  item_group text not null check (item_group in ('food', 'drink')),
  qty numeric(8,2) not null default 1,
  net_price numeric(10,2) not null default 0,   -- line total
  unit_cost numeric(10,2) not null default 0,
  import_id uuid references growth_imports on delete set null,
  primary key (venue_id, check_id, line_no),
  foreign key (venue_id, check_id) references growth_checks (venue_id, check_id) on delete cascade
);

create table growth_bookings (
  venue_id uuid not null references venues on delete cascade,
  booking_id text not null,
  booked_for timestamp not null,
  trading_day date not null,
  party_size numeric(8,2) not null default 2,
  status text not null check (status in ('seated', 'no_show', 'cancelled')),
  channel text not null default 'Unknown',
  lead_days int,
  import_id uuid references growth_imports on delete set null,
  primary key (venue_id, booking_id)
);
create index growth_bookings_day on growth_bookings (venue_id, trading_day);

-- Stored summaries, written by the engine after each import. Kept at full
-- precision so figures read from them equal figures from the raw rows.
create table growth_metric_day (
  venue_id uuid not null references venues on delete cascade,
  trading_day date not null,
  sales float8 not null, covers float8 not null, checks int not null,
  item_covers float8 not null, item_sales float8 not null,
  drink_qty float8 not null, drink_sales float8 not null, food_sales float8 not null,
  starters float8 not null, desserts float8 not null, cost float8 not null,
  dur_sum float8 not null, dur_n int not null,
  late_sales float8 not null,
  bookings_seated int not null, bookings_no_show int not null, bookings_cancelled int not null,
  primary key (venue_id, trading_day)
);

create table growth_metric_hour (
  venue_id uuid not null references venues on delete cascade,
  trading_day date not null,
  trading_hour int not null check (trading_hour between 5 and 29),
  sales float8 not null,          -- check totals spread across the hours occupied
  cover_hours float8 not null,
  primary key (venue_id, trading_day, trading_hour)
);

-- The programme.
create table growth_ideas (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references venues on delete cascade,
  gain_area text not null,
  change text not null,
  metric_key text not null,
  how_to_test text,
  guest_risk text,
  proposer_name text,
  status text not null default 'open' check (status in ('open', 'testing', 'declined')),
  created_at timestamptz not null default now()
);
create index growth_ideas_venue on growth_ideas (venue_id, created_at desc);

create table growth_tests (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references venues on delete cascade,
  idea_id uuid references growth_ideas on delete set null,
  name text not null,
  gain_area text not null,
  metric_key text not null,
  guardrail_key text,
  design text not null default 'before_after' check (design in ('before_after', 'alternate_weeks', 'split_section')),
  -- Tables in the test group, for a split-by-section design.
  test_tables text[] not null default '{}',
  start_day date not null,
  end_day date check (end_day is null or end_day >= start_day),
  pass_mark_pct numeric(6,2) not null,
  owner_name text,
  status text not null default 'planned' check (status in ('planned', 'live', 'read', 'banked', 'stopped')),
  -- The readout as it stood when the test was read.
  result jsonb,
  decided_by text,
  decided_at timestamptz,
  notes text,
  created_at timestamptz not null default now()
);
create index growth_tests_venue on growth_tests (venue_id, status);

create table growth_gains (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references venues on delete cascade,
  test_id uuid not null unique references growth_tests on delete cascade,
  change_pct numeric(8,3) not null,
  yearly_value numeric(12,2),
  banked_on date not null,
  -- A gain counts once it still holds 90 days on.
  recheck_day date not null,
  still_holding boolean,
  rechecked_on date
);
create index growth_gains_venue on growth_gains (venue_id, banked_on desc);

create table growth_bridge (
  venue_id uuid primary key references venues on delete cascade,
  assumptions jsonb not null,
  updated_at timestamptz not null default now()
);

create table growth_scorecards (
  venue_id uuid not null references venues on delete cascade,
  week_start date not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  emailed_at timestamptz,
  emailed_to text[] not null default '{}',
  primary key (venue_id, week_start)
);

-- Events and hire.
create table growth_enquiries (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references venues on delete cascade,
  received_at timestamp not null,
  source text,
  event_type text,
  requested_for date,
  party_size int,
  quote numeric(10,2),
  first_reply_at timestamp,
  outcome text not null default 'open' check (outcome in ('open', 'booked', 'lost', 'no_reply')),
  lost_reason text
);
create index growth_enquiries_venue on growth_enquiries (venue_id, received_at desc);

create table growth_events (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references venues on delete cascade,
  enquiry_id uuid references growth_enquiries on delete set null,
  name text not null,
  held_on date not null,
  space text,
  guests int,
  revenue numeric(10,2) not null default 0,
  cost_of_goods numeric(10,2) not null default 0,
  extra_labour numeric(10,2) not null default 0,
  direct_costs numeric(10,2) not null default 0,
  displaced_sales numeric(10,2) not null default 0,
  contribution_rate numeric(4,3) not null default 0.55 check (contribution_rate between 0 and 1)
);
create index growth_events_venue on growth_events (venue_id, held_on desc);

-- Row-level security. Everyone at the venue, viewers included, can read the
-- console. Managers load data and run the programme. Captains (hosts) and
-- above can add ideas. Figures for individual servers come from the raw
-- checks, so those rows are only readable at or above the venue's
-- server_figures_min_role; everyone else reads the stored summaries.
do $$
declare t text;
begin
  foreach t in array array[
    'growth_settings', 'growth_column_maps', 'growth_imports', 'growth_bookings', 'growth_metric_day', 'growth_metric_hour',
    'growth_tests', 'growth_gains', 'growth_bridge', 'growth_scorecards', 'growth_enquiries', 'growth_events'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for select to authenticated using (is_venue_member(venue_id, ''viewer''))', t || '_read', t);
    execute format('create policy %I on %I for all to authenticated using (is_venue_member(venue_id, ''manager'')) with check (is_venue_member(venue_id, ''manager''))', t || '_manage', t);
  end loop;
end $$;

create function growth_can_see_servers(v uuid) returns boolean
language sql stable security definer set search_path = public
as $$
  select is_venue_member(v, coalesce((select server_figures_min_role from growth_settings where venue_id = v), 'manager'));
$$;

alter table growth_checks enable row level security;
alter table growth_items enable row level security;
create policy growth_checks_read on growth_checks for select to authenticated using (growth_can_see_servers(venue_id));
create policy growth_checks_manage on growth_checks for all to authenticated
  using (is_venue_member(venue_id, 'manager')) with check (is_venue_member(venue_id, 'manager'));
create policy growth_items_read on growth_items for select to authenticated using (is_venue_member(venue_id, 'viewer'));
create policy growth_items_manage on growth_items for all to authenticated
  using (is_venue_member(venue_id, 'manager')) with check (is_venue_member(venue_id, 'manager'));

alter table growth_ideas enable row level security;
create policy growth_ideas_read on growth_ideas for select to authenticated using (is_venue_member(venue_id, 'viewer'));
create policy growth_ideas_add on growth_ideas for insert to authenticated
  with check (is_venue_member(venue_id, 'host') and status = 'open');
create policy growth_ideas_manage on growth_ideas for all to authenticated
  using (is_venue_member(venue_id, 'manager')) with check (is_venue_member(venue_id, 'manager'));
