-- Menu, POS and kitchen.
-- Menus belong to the company (shared by both sites); each site can hide items,
-- override prices, 86 items and count down limited stock. Orders, tickets and
-- payments belong to a site. Every order item carries its own timestamps
-- (sent, started, ready, served) so service speed can be measured per dish.

alter table venues add column service_charge_pct numeric(5,2) not null default 12.5
  check (service_charge_pct >= 0 and service_charge_pct <= 25);

-- ---------------------------------------------------------------------------
-- Stations: where items are made. Menu items route by station code
-- ('kitchen', 'bar', 'pastry', ...); each site maps codes to its own screens.
-- ---------------------------------------------------------------------------

create type station_kind as enum ('kitchen', 'bar', 'pass');

create table stations (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references venues on delete cascade,
  code text not null check (code ~ '^[a-z][a-z0-9_-]*$'),
  name text not null,
  kind station_kind not null default 'kitchen',
  sort_order int not null default 0,
  unique (venue_id, code)
);

-- ---------------------------------------------------------------------------
-- Staff identities for the till (who took the order, who was paid).
-- ---------------------------------------------------------------------------

create type staff_role as enum ('manager', 'server', 'bartender', 'chef', 'host');

create table staff_members (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies on delete cascade,
  name text not null,
  role staff_role not null default 'server',
  -- bcrypt hash of a 4-6 digit PIN; set with set_staff_pin().
  pin_hash text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (company_id, name)
);

create function set_staff_pin(staff uuid, pin text) returns void
language plpgsql as $$
begin
  if pin !~ '^\d{4,6}$' then raise exception 'PIN must be 4-6 digits'; end if;
  update staff_members set pin_hash = crypt(pin, gen_salt('bf', 8)) where id = staff;
end $$;

create function check_staff_pin(staff uuid, pin text) returns boolean
language sql stable as $$
  select exists (select 1 from staff_members s
                 where s.id = staff and s.active and s.pin_hash is not null
                   and s.pin_hash = crypt(pin, s.pin_hash));
$$;

-- ---------------------------------------------------------------------------
-- Menu
-- Courses: 0 = drinks (sent straight away), 1 = starters, 2 = mains, 3 = desserts.
-- ---------------------------------------------------------------------------

create table menu_categories (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies on delete cascade,
  name text not null,
  default_course int not null default 2 check (default_course between 0 and 9),
  default_station text not null default 'kitchen',
  sort_order int not null default 0,
  active boolean not null default true,
  unique (company_id, name)
);

create table menu_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies on delete cascade,
  category_id uuid not null references menu_categories on delete restrict,
  name text not null,
  description text,
  price int not null check (price >= 0),            -- pence, VAT-inclusive
  cost int check (cost >= 0),                        -- pence, for margins
  vat_rate numeric(5,2) not null default 20 check (vat_rate >= 0 and vat_rate <= 100),
  course int check (course between 0 and 9),         -- null = category default
  station text,                                      -- null = category default
  prep_minutes int not null default 10 check (prep_minutes between 0 and 240),
  allergens text[] not null default '{}',
  dietary text[] not null default '{}',              -- 'vegan', 'vegetarian', 'gf' ...
  sort_order int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (company_id, category_id, name)
);
create index menu_items_category on menu_items (category_id);

-- The 14 allergens UK law requires venues to declare.
create function valid_allergens(a text[]) returns boolean language sql immutable as $$
  select a <@ array['celery','gluten','crustaceans','eggs','fish','lupin','milk','molluscs',
                    'mustard','nuts','peanuts','sesame','soya','sulphites']
$$;
alter table menu_items add constraint menu_items_allergens_valid check (valid_allergens(allergens));

-- Per-site overrides.
create table menu_item_sites (
  menu_item_id uuid not null references menu_items on delete cascade,
  venue_id uuid not null references venues on delete cascade,
  hidden boolean not null default false,              -- never sold at this site
  price_override int check (price_override >= 0),
  eighty_sixed_at timestamptz,                        -- set = sold out right now
  stock_remaining int check (stock_remaining >= 0),   -- null = unlimited
  primary key (menu_item_id, venue_id)
);

create table modifier_groups (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies on delete cascade,
  name text not null,
  min_select int not null default 0 check (min_select >= 0),
  max_select int not null default 1 check (max_select >= 1 and max_select >= min_select),
  unique (company_id, name)
);

create table modifier_options (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references modifier_groups on delete cascade,
  name text not null,
  price_delta int not null default 0,  -- pence; may be negative
  sort_order int not null default 0,
  unique (group_id, name)
);

create table menu_item_modifier_groups (
  menu_item_id uuid not null references menu_items on delete cascade,
  group_id uuid not null references modifier_groups on delete cascade,
  sort_order int not null default 0,
  primary key (menu_item_id, group_id)
);

-- ---------------------------------------------------------------------------
-- Orders (checks)
-- ---------------------------------------------------------------------------

create type order_status as enum ('open', 'paid', 'void');

create table orders (
  id uuid primary key default gen_random_uuid(),
  number bigint generated always as identity,
  venue_id uuid not null references venues on delete cascade,
  table_id uuid references tables on delete set null,
  table_label text,                       -- snapshot, or "Bar", "Takeaway"
  booking_id uuid references bookings on delete set null,
  guest_id uuid references guests on delete set null,
  covers int not null default 1 check (covers >= 1),
  status order_status not null default 'open',
  opened_by uuid references staff_members on delete set null,
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  discount_kind text check (discount_kind in ('percent', 'amount')),
  discount_value int not null default 0 check (discount_value >= 0),
  discount_reason text,
  service_charge_pct numeric(5,2) not null default 0 check (service_charge_pct >= 0 and service_charge_pct <= 25),
  -- Totals snapshot when paid, for fast reporting (pence).
  total_gross int,
  total_vat int,
  total_service int,
  total_discount int,
  void_reason text,
  notes text,
  check (status <> 'open' or closed_at is null),
  check (discount_kind <> 'percent' or discount_value <= 100)
);
create index orders_venue_opened on orders (venue_id, opened_at);
create index orders_guest on orders (guest_id);
-- One open check per table.
create unique index orders_one_open_per_table on orders (table_id) where status = 'open' and table_id is not null;

create type order_item_status as enum ('held', 'sent', 'started', 'ready', 'served', 'void');

-- A batch of items sent to one station together.
create table tickets (
  id uuid primary key default gen_random_uuid(),
  number bigint generated always as identity,
  venue_id uuid not null references venues on delete cascade,
  order_id uuid not null references orders on delete cascade,
  station text not null,
  course int not null,
  fired_at timestamptz not null default now(),
  -- Set when every item on the ticket is ready (bumped from the station screen).
  bumped_at timestamptz,
  priority boolean not null default false     -- "rush" flag from the pass
);
create index tickets_open on tickets (venue_id, station) where bumped_at is null;

create table order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders on delete cascade,
  venue_id uuid not null references venues on delete cascade,
  menu_item_id uuid references menu_items on delete set null,
  ticket_id uuid references tickets on delete set null,
  -- Snapshots, so later menu edits don't rewrite history.
  name text not null,
  unit_price int not null check (unit_price >= 0),
  modifiers jsonb not null default '[]',      -- [{group, option, priceDelta}]
  modifiers_total int not null default 0,
  quantity int not null default 1 check (quantity >= 1),
  cost int,
  vat_rate numeric(5,2) not null default 20,
  course int not null default 2,
  station text not null default 'kitchen',
  prep_minutes int not null default 10,
  seat int check (seat >= 1),
  notes text,
  status order_item_status not null default 'held',
  comped boolean not null default false,
  comp_reason text,
  void_reason text,
  added_by uuid references staff_members on delete set null,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  started_at timestamptz,
  ready_at timestamptz,
  served_at timestamptz,
  voided_at timestamptz,
  check (not comped or comp_reason is not null),
  check (status <> 'void' or (void_reason is not null and voided_at is not null))
);
create index order_items_order on order_items (order_id);
create index order_items_ticket on order_items (ticket_id);
create index order_items_venue_time on order_items (venue_id, created_at);
create index order_items_menu_item on order_items (menu_item_id);

create type payment_method as enum ('card', 'cash', 'voucher', 'other');

create table order_payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders on delete cascade,
  venue_id uuid not null references venues on delete cascade,
  method payment_method not null,
  amount int not null check (amount > 0),     -- pence towards the bill
  tip int not null default 0 check (tip >= 0),
  reference text,
  taken_by uuid references staff_members on delete set null,
  created_at timestamptz not null default now()
);
create index order_payments_order on order_payments (order_id);

-- Orders, tickets and items must stay within one site.
create function order_children_same_venue() returns trigger
language plpgsql as $$
begin
  if not exists (select 1 from orders o where o.id = new.order_id and o.venue_id = new.venue_id) then
    raise exception '% must belong to the same site as its order', tg_table_name;
  end if;
  return new;
end $$;

create trigger order_items_same_venue before insert or update of order_id, venue_id on order_items
  for each row execute function order_children_same_venue();
create trigger tickets_same_venue before insert or update of order_id, venue_id on tickets
  for each row execute function order_children_same_venue();
create trigger order_payments_same_venue before insert or update of order_id, venue_id on order_payments
  for each row execute function order_children_same_venue();

create function orders_table_same_venue() returns trigger
language plpgsql as $$
begin
  if new.table_id is not null and not exists (
    select 1 from tables t where t.id = new.table_id and t.venue_id = new.venue_id) then
    raise exception 'table % is not at this site', new.table_id;
  end if;
  if new.booking_id is not null and not exists (
    select 1 from bookings b where b.id = new.booking_id and b.venue_id = new.venue_id) then
    raise exception 'booking % is not at this site', new.booking_id;
  end if;
  return new;
end $$;

create trigger orders_same_venue before insert or update of table_id, booking_id, venue_id on orders
  for each row execute function orders_table_same_venue();

-- Payments can't go on a closed or void check.
create function order_payments_open_only() returns trigger
language plpgsql as $$
begin
  if (select status from orders where id = new.order_id) <> 'open' then
    raise exception 'check is not open';
  end if;
  return new;
end $$;

create trigger order_payments_open_only before insert on order_payments
  for each row execute function order_payments_open_only();

-- ---------------------------------------------------------------------------
-- Row-level security, same model as bookings: site staff for operations,
-- company staff for the shared menu (managers edit).
-- ---------------------------------------------------------------------------

alter table stations enable row level security;
alter table staff_members enable row level security;
alter table menu_categories enable row level security;
alter table menu_items enable row level security;
alter table menu_item_sites enable row level security;
alter table modifier_groups enable row level security;
alter table modifier_options enable row level security;
alter table menu_item_modifier_groups enable row level security;
alter table orders enable row level security;
alter table tickets enable row level security;
alter table order_items enable row level security;
alter table order_payments enable row level security;

create policy stations_read on stations for select to authenticated using (is_venue_member(venue_id));
create policy stations_write on stations for all to authenticated
  using (is_venue_member(venue_id, 'manager')) with check (is_venue_member(venue_id, 'manager'));

do $$
declare t text;
begin
  foreach t in array array['staff_members', 'menu_categories', 'menu_items', 'modifier_groups']
  loop
    execute format('create policy %1$s_read on %1$I for select to authenticated using (is_company_staff(company_id))', t);
    execute format('create policy %1$s_write on %1$I for all to authenticated
                    using (is_company_staff(company_id, ''manager'')) with check (is_company_staff(company_id, ''manager''))', t);
  end loop;
  foreach t in array array['orders', 'tickets', 'order_items', 'order_payments']
  loop
    execute format('create policy %1$s_staff on %1$I for all to authenticated
                    using (is_venue_member(venue_id)) with check (is_venue_member(venue_id))', t);
  end loop;
end $$;

-- Hosts can 86 at their own site; only managers hide or reprice.
create policy menu_item_sites_read on menu_item_sites for select to authenticated using (is_venue_member(venue_id));
create policy menu_item_sites_write on menu_item_sites for all to authenticated
  using (is_venue_member(venue_id)) with check (is_venue_member(venue_id));

create policy modifier_options_read on modifier_options for select to authenticated
  using (exists (select 1 from modifier_groups g where g.id = group_id and is_company_staff(g.company_id)));
create policy modifier_options_write on modifier_options for all to authenticated
  using (exists (select 1 from modifier_groups g where g.id = group_id and is_company_staff(g.company_id, 'manager')))
  with check (exists (select 1 from modifier_groups g where g.id = group_id and is_company_staff(g.company_id, 'manager')));

create policy item_groups_read on menu_item_modifier_groups for select to authenticated
  using (exists (select 1 from menu_items i where i.id = menu_item_id and is_company_staff(i.company_id)));
create policy item_groups_write on menu_item_modifier_groups for all to authenticated
  using (exists (select 1 from menu_items i where i.id = menu_item_id and is_company_staff(i.company_id, 'manager')))
  with check (exists (select 1 from menu_items i where i.id = menu_item_id and is_company_staff(i.company_id, 'manager')));

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table orders, order_items, tickets;
  end if;
end $$;

-- PIN hashes never leave the server: staff can read names and roles only.
revoke all on staff_members from anon, authenticated;
grant select (id, company_id, name, role, active, created_at) on staff_members to authenticated;
grant insert (company_id, name, role, active), update (name, role, active), delete on staff_members to authenticated;
revoke execute on function set_staff_pin(uuid, text), check_staff_pin(uuid, text) from public, anon, authenticated;
