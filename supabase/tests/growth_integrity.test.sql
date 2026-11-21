-- Growth Console: two users in two organisations; neither can read or write the other's rows.
begin;

insert into companies (id, name, slug) values
  ('50000000-0000-0000-0000-0000000000c1', 'Org One', 'g-org-one'),
  ('50000000-0000-0000-0000-0000000000c2', 'Org Two', 'g-org-two');
insert into venues (id, company_id, name, slug) values
  ('50000000-0000-0000-0000-00000000000a', '50000000-0000-0000-0000-0000000000c1', 'One', 'g-one'),
  ('50000000-0000-0000-0000-00000000000b', '50000000-0000-0000-0000-0000000000c2', 'Two', 'g-two');
insert into venue_members values
  ('50000000-0000-0000-0000-00000000000a', '50000000-0000-0000-0000-000000000001', 'manager'),
  ('50000000-0000-0000-0000-00000000000b', '50000000-0000-0000-0000-000000000002', 'manager'),
  ('50000000-0000-0000-0000-00000000000a', '50000000-0000-0000-0000-000000000003', 'host'),
  ('50000000-0000-0000-0000-00000000000a', '50000000-0000-0000-0000-000000000004', 'viewer');

-- One row in every growth table, for each venue.
do $$
declare v uuid; imp uuid; idea uuid; test uuid; enq uuid;
begin
  foreach v in array array['50000000-0000-0000-0000-00000000000a'::uuid, '50000000-0000-0000-0000-00000000000b'::uuid] loop
    insert into growth_settings (venue_id) values (v);
    insert into growth_column_maps values (v, 'checks', '{}');
    insert into growth_imports (venue_id, kind, filename) values (v, 'checks', 'checks.csv') returning id into imp;
    insert into growth_checks (venue_id, check_id, opened_at, trading_day, import_id) values (v, 'C1', '2026-11-14 19:00', '2026-11-14', imp);
    insert into growth_items (venue_id, check_id, line_no, item, item_group) values (v, 'C1', 1, 'Tacos', 'food');
    insert into growth_bookings (venue_id, booking_id, booked_for, trading_day, status) values (v, 'B1', '2026-11-14 19:00', '2026-11-14', 'seated');
    insert into growth_metric_day values (v, '2026-11-14', 1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0,0);
    insert into growth_metric_hour values (v, '2026-11-14', 19, 1, 1);
    insert into growth_ideas (venue_id, gain_area, change, metric_key) values (v, 'Bar', 'Offer a named drink', 'dpc') returning id into idea;
    insert into growth_tests (venue_id, idea_id, name, gain_area, metric_key, start_day, pass_mark_pct) values (v, idea, 'First drink', 'Bar', 'dpc', '2026-11-16', 5) returning id into test;
    insert into growth_gains (venue_id, test_id, change_pct, banked_on, recheck_day) values (v, test, 5, '2026-11-20', '2027-02-18');
    insert into growth_bridge values (v, '{}');
    insert into growth_scorecards (venue_id, week_start, payload) values (v, '2026-11-09', '{}');
    insert into growth_enquiries (venue_id, received_at) values (v, '2026-11-14 10:00') returning id into enq;
    insert into growth_events (venue_id, enquiry_id, name, held_on) values (v, enq, 'Hire', '2026-12-01');
    insert into growth_actions (venue_id, ref, owner, task) values (v, 'A01', 'Owner', 'Find the licence');
    insert into growth_decisions (venue_id, item) values (v, 'Programme name');
    insert into growth_bets (venue_id, name) values (v, 'Late-night bar');
    insert into growth_meetings (venue_id, kind, held_on, title) values (v, 'huddle', '2026-11-21', 'Huddle');
    insert into growth_turnaways (venue_id, turned_at, party_size, reason) values (v, '2026-11-14 20:00', 4, 'Full');
  end loop;
end $$;

create function pg_temp.growth_tables() returns text[] language sql as $$
  select array['growth_settings', 'growth_column_maps', 'growth_imports', 'growth_checks', 'growth_items', 'growth_bookings',
    'growth_metric_day', 'growth_metric_hour', 'growth_ideas', 'growth_tests', 'growth_gains', 'growth_bridge',
    'growth_scorecards', 'growth_enquiries', 'growth_events', 'growth_actions', 'growth_decisions', 'growth_bets',
    'growth_meetings', 'growth_turnaways'];
$$;

-- Every growth table must have row-level security switched on.
do $$ declare t text; begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'growth\_%' loop
    if not (select relrowsecurity from pg_class where relname = t) then raise exception '% has no row-level security', t; end if;
    if not t = any(pg_temp.growth_tables()) then raise exception '% is not covered by this test', t; end if;
  end loop;
end $$;

-- As each manager: sees exactly their own row in every table, and cannot update, delete or insert into the other venue.
create function pg_temp.check_isolation(mine uuid, theirs uuid) returns void language plpgsql as $$
declare t text; n int;
begin
  foreach t in array pg_temp.growth_tables() loop
    execute format('select count(*) from %I', t) into n;
    if n <> 1 then raise exception '% as %: expected 1 visible row, saw %', t, mine, n; end if;
    execute format('select count(*) from %I where venue_id = $1', t) into n using theirs;
    if n <> 0 then raise exception '% leaks the other organisation''s rows', t; end if;
    execute format('update %I set venue_id = venue_id where venue_id = $1', t) using theirs;
    get diagnostics n = row_count;
    if n <> 0 then raise exception '% lets a manager update the other organisation''s rows', t; end if;
    execute format('delete from %I where venue_id = $1', t) using theirs;
    get diagnostics n = row_count;
    if n <> 0 then raise exception '% lets a manager delete the other organisation''s rows', t; end if;
  end loop;
  begin
    insert into growth_ideas (venue_id, gain_area, change, metric_key) values (theirs, 'Bar', 'x', 'dpc');
    raise exception 'manager inserted an idea into the other organisation';
  exception when insufficient_privilege then null; end;
  begin
    insert into growth_checks (venue_id, check_id, opened_at, trading_day) values (theirs, 'C9', '2026-11-14 19:00', '2026-11-14');
    raise exception 'manager inserted a check into the other organisation';
  exception when insufficient_privilege then null; end;
  begin
    insert into growth_bridge values (theirs, '{}') on conflict (venue_id) do update set assumptions = '{"x":1}';
    raise exception 'manager overwrote the other organisation''s bridge';
  exception when insufficient_privilege then null; end;
  -- Their own venue is writable.
  update growth_settings set seats = 70 where venue_id = mine;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'manager cannot update their own settings'; end if;
end $$;

set local role authenticated;
set local request.jwt.claim.sub = '50000000-0000-0000-0000-000000000001';
select pg_temp.check_isolation('50000000-0000-0000-0000-00000000000a', '50000000-0000-0000-0000-00000000000b');
set local request.jwt.claim.sub = '50000000-0000-0000-0000-000000000002';
select pg_temp.check_isolation('50000000-0000-0000-0000-00000000000b', '50000000-0000-0000-0000-00000000000a');

-- A captain (host) reads the console and adds ideas, but cannot load data, run tests or see server-level rows.
set local request.jwt.claim.sub = '50000000-0000-0000-0000-000000000003';
do $$ declare n int; begin
  if (select count(*) from growth_metric_day) <> 1 then raise exception 'captain should read the stored summaries'; end if;
  if exists (select 1 from growth_checks) then raise exception 'captain should not read server-level rows by default'; end if;
  insert into growth_ideas (venue_id, gain_area, change, metric_key) values ('50000000-0000-0000-0000-00000000000a', 'Floor service', 'Offer churros', 'dessertAttach');
  update growth_tests set status = 'live';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'captain should not change tests'; end if;
  insert into growth_turnaways (venue_id, turned_at, party_size, reason) values ('50000000-0000-0000-0000-00000000000a', '2026-11-14 21:00', 2, 'Full');
  update growth_actions set status = 'done';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'captain should tick actions at their own venue only, updated %', n; end if;
  delete from growth_actions;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'captain should not delete actions'; end if;
  update growth_bets set status = 'stopped';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'captain should not change big bets'; end if;
  begin
    insert into growth_ideas (venue_id, gain_area, change, metric_key, status) values ('50000000-0000-0000-0000-00000000000a', 'Bar', 'x', 'dpc', 'testing');
    raise exception 'captain should only add open ideas';
  exception when insufficient_privilege then null; end;
end $$;

-- A viewer reads, and writes nothing.
set local request.jwt.claim.sub = '50000000-0000-0000-0000-000000000004';
do $$ begin
  if (select count(*) from growth_tests) <> 1 then raise exception 'viewer should read tests'; end if;
  if exists (select 1 from bookings) or exists (select 1 from orders) then raise exception 'viewer should not reach the diary or the till'; end if;
  begin
    insert into growth_ideas (venue_id, gain_area, change, metric_key) values ('50000000-0000-0000-0000-00000000000a', 'Bar', 'x', 'dpc');
    raise exception 'viewer should not add ideas';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- Once the venue allows captains to see server figures, they can read checks.
update growth_settings set server_figures_min_role = 'host' where venue_id = '50000000-0000-0000-0000-00000000000a';
set local role authenticated;
set local request.jwt.claim.sub = '50000000-0000-0000-0000-000000000003';
do $$ begin
  if (select count(*) from growth_checks) <> 1 then raise exception 'captain should read checks once allowed'; end if;
end $$;
set local request.jwt.claim.sub = '50000000-0000-0000-0000-000000000099';
do $$ declare t text; n int; begin
  foreach t in array pg_temp.growth_tables() loop
    execute format('select count(*) from %I', t) into n;
    if n <> 0 then raise exception 'a stranger can read %', t; end if;
  end loop;
end $$;
reset role;

rollback;
\echo 'growth_integrity: ok'
