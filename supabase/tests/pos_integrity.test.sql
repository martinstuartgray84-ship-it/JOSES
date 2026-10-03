-- Menu, orders and payments integrity. Each check raises on failure.
begin;

create function pg_temp.expect_error(stmt text, code text) returns void language plpgsql as $$
begin
  execute stmt;
  raise exception 'expected % from: %', code, stmt;
exception when others then
  if sqlstate <> code then raise; end if;
end $$;

insert into companies (id, name, slug) values ('00000000-0000-0000-0000-0000000000f1', 'Co', 'co');
insert into venues (id, company_id, name, slug) values
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000f1', 'A', 'a'),
  ('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000f1', 'B', 'b');
insert into areas (id, venue_id, name) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000a', 'Main'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000000b', 'Main');
insert into tables (id, venue_id, area_id, label, min_covers, max_covers) values
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a1', 'T1', 1, 4),
  ('00000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000b1', 'X1', 1, 4);
insert into menu_categories (id, company_id, name) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000f1', 'Mains');

-- Allergens must be from the UK 14.
insert into menu_items (company_id, category_id, name, price, allergens) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000c1', 'Burger', 1450, '{gluten,milk}');
select pg_temp.expect_error($$ insert into menu_items (company_id, category_id, name, price, allergens)
  values ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000c1', 'Odd', 100, '{garlic}') $$, '23514');

-- One open check per table; a table from another site is refused.
insert into orders (id, venue_id, table_id, covers) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000001', 2);
select pg_temp.expect_error($$ insert into orders (venue_id, table_id) values
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000001') $$, '23505');
select pg_temp.expect_error($$ insert into orders (venue_id, table_id) values
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000009') $$, 'P0001');

-- Items and payments must be at the order's site.
select pg_temp.expect_error($$ insert into order_items (order_id, venue_id, name, unit_price) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', 'Burger', 1450) $$, 'P0001');
insert into order_items (order_id, venue_id, name, unit_price) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'Burger', 1450);
-- Comps and voids need reasons.
select pg_temp.expect_error($$ update order_items set comped = true where order_id = '10000000-0000-0000-0000-000000000001' $$, '23514');
select pg_temp.expect_error($$ update order_items set status = 'void' where order_id = '10000000-0000-0000-0000-000000000001' $$, '23514');

insert into order_payments (order_id, venue_id, method, amount) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'card', 1450);
update orders set status = 'paid', closed_at = now() where id = '10000000-0000-0000-0000-000000000001';
select pg_temp.expect_error($$ insert into order_payments (order_id, venue_id, method, amount) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'cash', 100) $$, 'P0001');
-- Once paid, the table can take a new check.
insert into orders (venue_id, table_id) values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000001');

-- PINs: hashed, checked, never readable by staff.
insert into staff_members (id, company_id, name) values ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000f1', 'Sam');
select set_staff_pin('20000000-0000-0000-0000-000000000001', '4321');
select pg_temp.expect_error($$ select set_staff_pin('20000000-0000-0000-0000-000000000001', '12') $$, 'P0001');
do $$ begin
  if not check_staff_pin('20000000-0000-0000-0000-000000000001', '4321') then raise exception 'right PIN refused'; end if;
  if check_staff_pin('20000000-0000-0000-0000-000000000001', '1234') then raise exception 'wrong PIN accepted'; end if;
  if (select pin_hash from staff_members) like '%4321%' then raise exception 'PIN stored in clear'; end if;
end $$;
insert into company_members values ('00000000-0000-0000-0000-0000000000f1', '30000000-0000-0000-0000-000000000001', 'manager');
set local role authenticated;
set local request.jwt.claim.sub = '30000000-0000-0000-0000-000000000001';
select pg_temp.expect_error($$ select pin_hash from staff_members $$, '42501');
do $$ begin
  if (select count(*) from staff_members) <> 1 then raise exception 'manager should see staff names'; end if;
end $$;
reset role;

rollback;
\echo 'pos_integrity: ok'
