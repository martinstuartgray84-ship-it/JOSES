-- Core reservations schema.
-- The availability engine (src/availability) decides what to offer; the exclusion
-- constraint on booking_tables is the last line of defence against double-booking
-- when two requests race for the same table.

create extension if not exists btree_gist;
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Company, sites and staff access
-- One company runs several sites (venues). Guests are shared across the company;
-- floor plans, services and bookings belong to a site.
-- ---------------------------------------------------------------------------

create table companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now()
);

create table venues (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies on delete cascade,
  name text not null,
  slug text not null unique,
  timezone text not null default 'Europe/London',
  -- Minimum notice for online bookings.
  min_notice_minutes int not null default 60 check (min_notice_minutes >= 0),
  -- How far ahead online bookings open.
  booking_window_days int not null default 90 check (booking_window_days > 0),
  created_at timestamptz not null default now()
);

create index venues_company on venues (company_id);

-- Enum order matters: owner < manager < host, so "role <= min_role" means "at least min_role".
create type venue_role as enum ('owner', 'manager', 'host');

-- Company-wide staff: the role applies at every site.
create table company_members (
  company_id uuid not null references companies on delete cascade,
  user_id uuid not null,
  role venue_role not null default 'host',
  primary key (company_id, user_id)
);

-- Site-specific staff, e.g. a host who only works at one site.
create table venue_members (
  venue_id uuid not null references venues on delete cascade,
  user_id uuid not null,
  role venue_role not null default 'host',
  primary key (venue_id, user_id)
);

create function is_venue_member(v uuid, min_role venue_role default 'host')
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from venue_members m
    where m.venue_id = v and m.user_id = auth.uid() and m.role <= min_role
  ) or exists (
    select 1 from venues ve join company_members cm on cm.company_id = ve.company_id
    where ve.id = v and cm.user_id = auth.uid() and cm.role <= min_role
  );
$$;

-- Anyone who works at any of the company's sites (used for the shared guest list).
create function is_company_staff(c uuid, min_role venue_role default 'host')
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from company_members cm
    where cm.company_id = c and cm.user_id = auth.uid() and cm.role <= min_role
  ) or exists (
    select 1 from venue_members m join venues ve on ve.id = m.venue_id
    where ve.company_id = c and m.user_id = auth.uid() and m.role <= min_role
  );
$$;

-- ---------------------------------------------------------------------------
-- Floor plan
-- ---------------------------------------------------------------------------

create table areas (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references venues on delete cascade,
  name text not null,
  sort_order int not null default 0,
  unique (venue_id, name)
);

create table tables (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references venues on delete cascade,
  area_id uuid not null references areas on delete restrict,
  label text not null,
  min_covers int not null check (min_covers >= 1),
  max_covers int not null check (max_covers >= min_covers),
  bookable_online boolean not null default true,
  -- Floor plan position for the host view.
  pos_x int, pos_y int, shape text check (shape in ('round', 'square', 'rect')),
  active boolean not null default true,
  unique (venue_id, label)
);

create table table_combinations (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references venues on delete cascade,
  label text not null,
  min_covers int not null check (min_covers >= 1),
  max_covers int not null check (max_covers >= min_covers),
  bookable_online boolean not null default true,
  unique (venue_id, label)
);

create table table_combination_members (
  combination_id uuid not null references table_combinations on delete cascade,
  table_id uuid not null references tables on delete cascade,
  primary key (combination_id, table_id)
);

-- Maintenance, private hire, etc.
create table table_blocks (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references venues on delete cascade,
  table_id uuid not null references tables on delete cascade,
  during tstzrange not null check (not isempty(during)),
  reason text
);
create index table_blocks_lookup on table_blocks using gist (table_id, during);

-- ---------------------------------------------------------------------------
-- Services and rules
-- ---------------------------------------------------------------------------

create table services (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references venues on delete cascade,
  name text not null,
  days_of_week int[] not null check (days_of_week <@ array[0,1,2,3,4,5,6]),
  -- Minutes from local midnight; may exceed 1440 for services that run past midnight.
  first_seating int not null check (first_seating >= 0),
  last_seating int not null check (last_seating >= first_seating),
  slot_interval_minutes int not null default 15 check (slot_interval_minutes > 0),
  buffer_minutes int not null default 0 check (buffer_minutes >= 0),
  min_covers int not null default 1 check (min_covers >= 1),
  max_covers int not null default 8 check (max_covers >= min_covers),
  max_covers_per_slot int check (max_covers_per_slot > 0),
  max_bookings_per_slot int check (max_bookings_per_slot > 0),
  area_ids uuid[],
  valid_from date,
  valid_to date check (valid_to >= valid_from),
  active boolean not null default true
);

create table service_turn_times (
  service_id uuid not null references services on delete cascade,
  max_covers int not null check (max_covers >= 1),
  minutes int not null check (minutes > 0),
  primary key (service_id, max_covers)
);

-- Whole-day or partial closures (bank holidays, private events).
create table closures (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references venues on delete cascade,
  service_id uuid references services on delete cascade, -- null = whole venue
  date date not null,
  reason text
);

-- Card hold / deposit / prepayment rules, matched by date, time, party size.
create type payment_rule_kind as enum ('card_hold', 'deposit', 'prepayment');

create table payment_rules (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references venues on delete cascade,
  service_id uuid references services on delete cascade,
  kind payment_rule_kind not null,
  min_covers int not null default 1,
  days_of_week int[],
  date_from date,
  date_to date,
  -- Per cover, in minor units (pence).
  amount_per_cover int not null check (amount_per_cover >= 0),
  -- No-show / late-cancel fee charged against a card hold.
  no_show_fee_per_cover int check (no_show_fee_per_cover >= 0),
  cancellation_cutoff_hours int not null default 24,
  priority int not null default 0
);

-- ---------------------------------------------------------------------------
-- Guests (company-wide CRM: one record per person across both sites)
-- ---------------------------------------------------------------------------

create table guests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies on delete cascade,
  first_name text not null,
  last_name text,
  email text,
  phone text,
  notes text,
  tags text[] not null default '{}',
  marketing_opt_in boolean not null default false,
  stripe_customer_id text,
  created_at timestamptz not null default now()
);
create unique index guests_email_per_company on guests (company_id, lower(email)) where email is not null;
create index guests_phone on guests (company_id, phone);

-- ---------------------------------------------------------------------------
-- Bookings
-- ---------------------------------------------------------------------------

create type booking_status as enum ('pending', 'confirmed', 'seated', 'completed', 'cancelled', 'no_show');
create type booking_channel as enum ('online', 'phone', 'walk_in', 'staff', 'google', 'other');

create table bookings (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references venues on delete cascade,
  service_id uuid not null references services on delete restrict,
  guest_id uuid references guests on delete set null,
  covers int not null check (covers >= 1),
  starts_at timestamptz not null,
  duration_minutes int not null check (duration_minutes > 0),
  buffer_minutes int not null default 0 check (buffer_minutes >= 0),
  -- Period the tables are unavailable: dining time plus reset buffer. Set by trigger
  -- (timestamptz arithmetic isn't immutable, so it can't be a generated column).
  blocked_during tstzrange not null,
  status booking_status not null default 'confirmed',
  channel booking_channel not null default 'online',
  special_requests text,
  -- Opaque token for the guest's self-serve amend/cancel link.
  manage_token text not null unique default encode(gen_random_bytes(24), 'hex'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index bookings_venue_time on bookings (venue_id, starts_at);
create index bookings_guest on bookings (guest_id);

-- A booking's guest must belong to the same company as its site.
create function bookings_guest_same_company() returns trigger
language plpgsql as $$
begin
  if new.guest_id is not null and not exists (
    select 1 from guests g join venues v on v.company_id = g.company_id
    where g.id = new.guest_id and v.id = new.venue_id
  ) then
    raise exception 'guest % does not belong to this site''s company', new.guest_id;
  end if;
  return new;
end $$;

create trigger bookings_guest_same_company
before insert or update of guest_id, venue_id on bookings
for each row execute function bookings_guest_same_company();

-- Which tables a booking occupies. Denormalises the booking's time range and
-- status so the exclusion constraint can be checked on this table alone.
create table booking_tables (
  booking_id uuid not null references bookings on delete cascade,
  table_id uuid not null references tables on delete restrict,
  blocked_during tstzrange not null,
  holds_table boolean not null,
  primary key (booking_id, table_id),
  constraint no_double_booking
    exclude using gist (table_id with =, blocked_during with &&) where (holds_table)
);

create function booking_holds_table(s booking_status) returns boolean
language sql immutable as $$ select s in ('pending', 'confirmed', 'seated') $$;

-- Fill the denormalised columns on insert.
create function booking_tables_fill() returns trigger
language plpgsql as $$
begin
  select b.blocked_during, booking_holds_table(b.status)
    into new.blocked_during, new.holds_table
  from bookings b where b.id = new.booking_id;
  return new;
end $$;

create trigger booking_tables_fill
before insert on booking_tables
for each row execute function booking_tables_fill();

create function bookings_before_write() returns trigger
language plpgsql as $$
begin
  new.blocked_during := tstzrange(
    new.starts_at,
    new.starts_at + make_interval(mins => new.duration_minutes + new.buffer_minutes),
    '[)');
  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;
  return new;
end $$;

create trigger bookings_before_write
before insert or update on bookings
for each row execute function bookings_before_write();

-- Keep booking_tables in sync when a booking moves, changes length, or changes status.

create function bookings_propagate() returns trigger
language plpgsql as $$
begin
  if new.blocked_during is distinct from old.blocked_during
     or booking_holds_table(new.status) is distinct from booking_holds_table(old.status) then
    update booking_tables
       set blocked_during = new.blocked_during,
           holds_table = booking_holds_table(new.status)
     where booking_id = new.id;
  end if;
  return null;
end $$;

create trigger bookings_propagate
after update on bookings
for each row execute function bookings_propagate();

-- Tables must belong to the booking's venue.
create function booking_tables_same_venue() returns trigger
language plpgsql as $$
begin
  if not exists (
    select 1 from bookings b join tables t on t.venue_id = b.venue_id
    where b.id = new.booking_id and t.id = new.table_id
  ) then
    raise exception 'table % is not in the booking''s venue', new.table_id;
  end if;
  return new;
end $$;

create trigger booking_tables_same_venue
before insert or update of table_id on booking_tables
for each row execute function booking_tables_same_venue();

-- ---------------------------------------------------------------------------
-- Payments (Stripe)
-- ---------------------------------------------------------------------------

create type payment_kind as enum ('card_hold', 'deposit', 'prepayment', 'no_show_fee', 'refund');
create type payment_status as enum ('requires_action', 'succeeded', 'failed', 'cancelled', 'refunded');

create table payments (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references venues on delete cascade,
  booking_id uuid not null references bookings on delete cascade,
  kind payment_kind not null,
  status payment_status not null default 'requires_action',
  amount int not null default 0 check (amount >= 0), -- minor units
  currency char(3) not null default 'GBP',
  stripe_setup_intent_id text unique,
  stripe_payment_intent_id text unique,
  created_at timestamptz not null default now()
);
create index payments_booking on payments (booking_id);

-- ---------------------------------------------------------------------------
-- Row-level security: staff see only their own venues.
-- Guests never query tables directly; public booking goes through server
-- routes using the service role, which bypasses RLS.
-- ---------------------------------------------------------------------------

alter table companies enable row level security;
alter table company_members enable row level security;
alter table venues enable row level security;
alter table venue_members enable row level security;
alter table areas enable row level security;
alter table tables enable row level security;
alter table table_combinations enable row level security;
alter table table_combination_members enable row level security;
alter table table_blocks enable row level security;
alter table services enable row level security;
alter table service_turn_times enable row level security;
alter table closures enable row level security;
alter table payment_rules enable row level security;
alter table guests enable row level security;
alter table bookings enable row level security;
alter table booking_tables enable row level security;
alter table payments enable row level security;

create policy companies_read on companies for select to authenticated using (is_company_staff(id));
create policy companies_write on companies for update to authenticated using (is_company_staff(id, 'owner'));

create policy company_members_read on company_members for select to authenticated using (is_company_staff(company_id));
create policy company_members_write on company_members for all to authenticated
  using (is_company_staff(company_id, 'owner')) with check (is_company_staff(company_id, 'owner'));

create policy venues_read on venues for select to authenticated using (is_venue_member(id));
create policy venues_write on venues for update to authenticated using (is_venue_member(id, 'owner'));

create policy members_read on venue_members for select to authenticated using (is_venue_member(venue_id));
create policy members_write on venue_members for all to authenticated
  using (is_venue_member(venue_id, 'owner')) with check (is_venue_member(venue_id, 'owner'));

-- Configuration: everyone reads, managers write.
do $$
declare t text;
begin
  foreach t in array array['areas', 'tables', 'table_combinations', 'table_blocks', 'services', 'closures', 'payment_rules']
  loop
    execute format('create policy %1$s_read on %1$I for select to authenticated using (is_venue_member(venue_id))', t);
    execute format('create policy %1$s_write on %1$I for all to authenticated
                    using (is_venue_member(venue_id, ''manager'')) with check (is_venue_member(venue_id, ''manager''))', t);
  end loop;
  -- Day-to-day operations: any staff member can read and write.
  foreach t in array array['bookings', 'payments']
  loop
    execute format('create policy %1$s_staff on %1$I for all to authenticated
                    using (is_venue_member(venue_id)) with check (is_venue_member(venue_id))', t);
  end loop;
end $$;

create policy guests_staff on guests for all to authenticated
  using (is_company_staff(company_id)) with check (is_company_staff(company_id));

create policy combination_members_read on table_combination_members for select to authenticated
  using (exists (select 1 from table_combinations c where c.id = combination_id and is_venue_member(c.venue_id)));
create policy combination_members_write on table_combination_members for all to authenticated
  using (exists (select 1 from table_combinations c where c.id = combination_id and is_venue_member(c.venue_id, 'manager')))
  with check (exists (select 1 from table_combinations c where c.id = combination_id and is_venue_member(c.venue_id, 'manager')));

create policy turn_times_read on service_turn_times for select to authenticated
  using (exists (select 1 from services s where s.id = service_id and is_venue_member(s.venue_id)));
create policy turn_times_write on service_turn_times for all to authenticated
  using (exists (select 1 from services s where s.id = service_id and is_venue_member(s.venue_id, 'manager')))
  with check (exists (select 1 from services s where s.id = service_id and is_venue_member(s.venue_id, 'manager')));

create policy booking_tables_staff on booking_tables for all to authenticated
  using (exists (select 1 from bookings b where b.id = booking_id and is_venue_member(b.venue_id)))
  with check (exists (select 1 from bookings b where b.id = booking_id and is_venue_member(b.venue_id)));

-- Live diary updates for the host view.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table bookings, booking_tables;
  end if;
end $$;

-- Guest history across both sites, for the CRM and the host's "regular" badge.
create view guest_stats with (security_invoker = true) as
select
  g.id as guest_id,
  g.company_id,
  count(b.id) filter (where b.status in ('seated', 'completed')) as visits,
  count(b.id) filter (where b.status = 'no_show') as no_shows,
  count(b.id) filter (where b.status = 'cancelled') as cancellations,
  count(distinct b.venue_id) filter (where b.status in ('seated', 'completed')) as sites_visited,
  max(b.starts_at) filter (where b.status in ('seated', 'completed')) as last_visit_at,
  min(b.starts_at) filter (where b.status in ('pending', 'confirmed') and b.starts_at > now()) as next_booking_at
from guests g
left join bookings b on b.guest_id = g.id
group by g.id, g.company_id;
