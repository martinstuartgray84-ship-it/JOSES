-- Double-booking protection and RLS. Each check raises on failure.
\set QUIET on
begin;

insert into venues (id, name, slug) values
  ('00000000-0000-0000-0000-00000000000a', 'Jose''s', 'joses'),
  ('00000000-0000-0000-0000-00000000000b', 'Other', 'other');
insert into areas (id, venue_id, name) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000a', 'Main'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000000b', 'Main');
insert into tables (id, venue_id, area_id, label, min_covers, max_covers) values
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a1', 'T1', 1, 2),
  ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a1', 'T2', 1, 2),
  ('00000000-0000-0000-0000-0000000000b9', '00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000b1', 'X1', 1, 2);
insert into services (id, venue_id, name, days_of_week, first_seating, last_seating, buffer_minutes) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-00000000000a', 'Dinner', '{5}', 1020, 1260, 15);
insert into service_turn_times values ('00000000-0000-0000-0000-0000000000c1', 8, 90);

create function pg_temp.book(id uuid, starts text, tbl uuid) returns void language sql as $$
  insert into bookings (id, venue_id, service_id, covers, starts_at, duration_minutes, buffer_minutes)
  values (id, '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c1', 2, starts::timestamptz, 90, 15);
  insert into booking_tables (booking_id, table_id) values (id, tbl);
$$;

create function pg_temp.expect_error(stmt text, code text) returns void language plpgsql as $$
begin
  execute stmt;
  raise exception 'expected % from: %', code, stmt;
exception when others then
  if sqlstate <> code then raise; end if;
end $$;

-- 19:00-20:30 + 15 min buffer on T1.
select pg_temp.book('10000000-0000-0000-0000-000000000001', '2026-10-09 19:00+01', '00000000-0000-0000-0000-000000000001');

-- Overlapping booking on the same table is refused (23P01 = exclusion_violation).
select pg_temp.expect_error($$ select pg_temp.book('10000000-0000-0000-0000-000000000002', '2026-10-09 20:00+01', '00000000-0000-0000-0000-000000000001') $$, '23P01');
-- Starting inside the reset buffer is refused too.
select pg_temp.expect_error($$ select pg_temp.book('10000000-0000-0000-0000-000000000002', '2026-10-09 20:40+01', '00000000-0000-0000-0000-000000000001') $$, '23P01');
-- Right after the buffer is fine; so is a different table at the same time.
select pg_temp.book('10000000-0000-0000-0000-000000000003', '2026-10-09 20:45+01', '00000000-0000-0000-0000-000000000001');
select pg_temp.book('10000000-0000-0000-0000-000000000004', '2026-10-09 19:00+01', '00000000-0000-0000-0000-000000000002');

-- Moving a booking onto an occupied slot is refused via the propagation trigger.
select pg_temp.expect_error($$ update bookings set starts_at = '2026-10-09 19:30+01' where id = '10000000-0000-0000-0000-000000000003' $$, '23P01');

-- Cancelling frees the table.
update bookings set status = 'cancelled' where id = '10000000-0000-0000-0000-000000000001';
select pg_temp.book('10000000-0000-0000-0000-000000000005', '2026-10-09 19:00+01', '00000000-0000-0000-0000-000000000001');
-- Reinstating the cancelled booking now clashes.
select pg_temp.expect_error($$ update bookings set status = 'confirmed' where id = '10000000-0000-0000-0000-000000000001' $$, '23P01');

-- A table from another venue can't be attached.
select pg_temp.expect_error($$ select pg_temp.book('10000000-0000-0000-0000-000000000006', '2026-10-09 22:00+01', '00000000-0000-0000-0000-0000000000b9') $$, 'P0001');

-- Manage tokens are generated and unique.
do $$ begin
  if (select count(distinct manage_token) from bookings) <> (select count(*) from bookings) then
    raise exception 'manage tokens missing or duplicated';
  end if;
end $$;

-- RLS: a host at venue A sees A's bookings only and can't edit services.
insert into venue_members values ('00000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-000000000001', 'host');
set local role authenticated;
set local request.jwt.claim.sub = '20000000-0000-0000-0000-000000000001';
do $$ begin
  if (select count(*) from bookings) <> 4 then raise exception 'host should see 4 venue A bookings, saw %', (select count(*) from bookings); end if;
  if exists (select 1 from venues where slug = 'other') then raise exception 'host can see another venue'; end if;
  update services set buffer_minutes = 0;
  if found then raise exception 'host should not be able to edit services'; end if;
end $$;
-- Stranger sees nothing.
set local request.jwt.claim.sub = '20000000-0000-0000-0000-000000000099';
do $$ begin
  if exists (select 1 from bookings) then raise exception 'non-member can see bookings'; end if;
end $$;
reset role;

rollback;
\echo 'booking_integrity: ok'
