-- Placeholder data for local development: one company, two sites.
-- Replace names, tables and service times with the real ones.
insert into companies (id, name, slug) values
  ('11111111-0000-0000-0000-000000000000', 'Jose''s', 'joses');

insert into venues (id, company_id, name, slug) values
  ('11111111-0000-0000-0000-00000000000a', '11111111-0000-0000-0000-000000000000', 'Jose''s Site One', 'site-one'),
  ('11111111-0000-0000-0000-00000000000b', '11111111-0000-0000-0000-000000000000', 'Jose''s Site Two', 'site-two');

insert into areas (id, venue_id, name) values
  ('11111111-0000-0000-0000-0000000000a1', '11111111-0000-0000-0000-00000000000a', 'Restaurant'),
  ('11111111-0000-0000-0000-0000000000b1', '11111111-0000-0000-0000-00000000000b', 'Restaurant');

-- Site One: 4 two-tops, 3 four-tops, one six; Site Two: 3 two-tops, 2 four-tops.
insert into tables (venue_id, area_id, label, min_covers, max_covers)
select '11111111-0000-0000-0000-00000000000a'::uuid, '11111111-0000-0000-0000-0000000000a1'::uuid, label, mn, mx
from (values ('1',1,2),('2',1,2),('3',1,2),('4',1,2),('5',2,4),('6',2,4),('7',2,4),('8',4,6)) t(label, mn, mx)
union all
select '11111111-0000-0000-0000-00000000000b'::uuid, '11111111-0000-0000-0000-0000000000b1'::uuid, label, mn, mx
from (values ('1',1,2),('2',1,2),('3',1,2),('4',2,4),('5',2,4)) t(label, mn, mx);

-- Tables 1+2 at each site join to seat four.
with c as (
  insert into table_combinations (venue_id, label, min_covers, max_covers)
  values ('11111111-0000-0000-0000-00000000000a', '1+2', 3, 4),
         ('11111111-0000-0000-0000-00000000000b', '1+2', 3, 4)
  returning id, venue_id
)
insert into table_combination_members (combination_id, table_id)
select c.id, t.id from c join tables t on t.venue_id = c.venue_id and t.label in ('1', '2');

-- Lunch Wed-Sun 12:00-14:30, dinner Tue-Sat 17:00-21:30 at both sites.
with s as (
  insert into services (venue_id, name, days_of_week, first_seating, last_seating, buffer_minutes, max_covers_per_slot)
  select v.id, x.name, x.days, x.first, x.last, 15, x.pacing
  from venues v,
       (values ('Lunch', '{0,3,4,5,6}'::int[], 720, 870, 12),
               ('Dinner', '{2,3,4,5,6}'::int[], 1020, 1290, 16)) x(name, days, first, last, pacing)
  where v.company_id = '11111111-0000-0000-0000-000000000000'
  returning id, name
)
insert into service_turn_times (service_id, max_covers, minutes)
select s.id, t.max_covers, case when s.name = 'Lunch' then t.minutes - 15 else t.minutes end
from s, (values (2, 90), (4, 105), (8, 135)) t(max_covers, minutes);

-- Stations at both sites: kitchen, bar and the pass.
insert into stations (venue_id, code, name, kind, sort_order)
select v.id, s.code, s.name, s.kind::station_kind, s.ord
from venues v, (values ('kitchen', 'Kitchen', 'kitchen', 0), ('bar', 'Bar', 'bar', 1), ('pass', 'Pass', 'pass', 2)) s(code, name, kind, ord)
where v.company_id = '11111111-0000-0000-0000-000000000000';

-- Till users (placeholder PINs: change them).
insert into staff_members (id, company_id, name, role) values
  ('22222222-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000000', 'Maria', 'manager'),
  ('22222222-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000000', 'Tom', 'server'),
  ('22222222-0000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000000', 'Aisha', 'server'),
  ('22222222-0000-0000-0000-000000000004', '11111111-0000-0000-0000-000000000000', 'Leo', 'bartender');
select set_staff_pin('22222222-0000-0000-0000-000000000001', '1111');
select set_staff_pin('22222222-0000-0000-0000-000000000002', '2222');
select set_staff_pin('22222222-0000-0000-0000-000000000003', '3333');
select set_staff_pin('22222222-0000-0000-0000-000000000004', '4444');

-- Placeholder menu (replace by importing your own from the Menu screen).
insert into menu_categories (company_id, name, default_course, default_station, sort_order) values
  ('11111111-0000-0000-0000-000000000000', 'Small plates', 1, 'kitchen', 1),
  ('11111111-0000-0000-0000-000000000000', 'Mains', 2, 'kitchen', 2),
  ('11111111-0000-0000-0000-000000000000', 'Sides', 2, 'kitchen', 3),
  ('11111111-0000-0000-0000-000000000000', 'Desserts', 3, 'kitchen', 4),
  ('11111111-0000-0000-0000-000000000000', 'Cocktails', 0, 'bar', 5),
  ('11111111-0000-0000-0000-000000000000', 'Wine', 0, 'bar', 6),
  ('11111111-0000-0000-0000-000000000000', 'Beer & soft', 0, 'bar', 7),
  ('11111111-0000-0000-0000-000000000000', 'Hot drinks', 0, 'bar', 8);

insert into menu_items (company_id, category_id, name, description, price, cost, prep_minutes, allergens, dietary, sort_order)
select '11111111-0000-0000-0000-000000000000', c.id, i.name, i.descr, i.price, i.cost, i.prep, i.allergens::text[], i.dietary::text[], i.ord
from (values
  ('Small plates', 'Sourdough & whipped butter', null, 550, 90, 3, '{gluten,milk}', '{vegetarian}', 1),
  ('Small plates', 'Burrata, heritage tomato', 'Basil oil, aged balsamic', 1050, 380, 4, '{milk}', '{vegetarian,gf}', 2),
  ('Small plates', 'Crispy squid', 'Lemon aioli', 950, 260, 6, '{molluscs,eggs,gluten}', '{}', 3),
  ('Small plates', 'Soup of the day', 'Ask your server', 750, 120, 5, '{celery,milk}', '{vegetarian}', 4),
  ('Small plates', 'Chicken liver parfait', 'Fig chutney, toast', 900, 210, 4, '{gluten,milk,eggs,sulphites}', '{}', 5),
  ('Mains', 'Ribeye 10oz', '28-day aged, peppercorn sauce', 2900, 1050, 14, '{milk,sulphites}', '{gf}', 1),
  ('Mains', 'Roast cod', 'Mussels, saffron, fennel', 2200, 720, 12, '{fish,molluscs,milk}', '{gf}', 2),
  ('Mains', 'Chicken supreme', 'Wild mushrooms, mash', 1950, 540, 13, '{milk,celery}', '{gf}', 3),
  ('Mains', 'Wild mushroom risotto', 'Truffle, parmesan', 1700, 380, 15, '{milk}', '{vegetarian,gf}', 4),
  ('Mains', 'House burger', 'Aged cheddar, pickles, fries', 1650, 480, 10, '{gluten,milk,eggs,mustard,sesame}', '{}', 5),
  ('Sides', 'Skinny fries', null, 450, 60, 5, '{}', '{vegan,gf}', 1),
  ('Sides', 'Green salad', null, 450, 70, 2, '{mustard}', '{vegan,gf}', 2),
  ('Sides', 'Tenderstem, chilli', null, 550, 110, 6, '{}', '{vegan,gf}', 3),
  ('Desserts', 'Sticky toffee pudding', 'Clotted cream', 850, 140, 6, '{gluten,milk,eggs}', '{vegetarian}', 1),
  ('Desserts', 'Dark chocolate tart', 'Crème fraîche', 850, 170, 3, '{gluten,milk,eggs}', '{vegetarian}', 2),
  ('Desserts', 'Sorbet', 'Three scoops', 650, 90, 2, '{}', '{vegan,gf}', 3),
  ('Cocktails', 'Negroni', null, 1100, 230, 2, '{}', '{vegan}', 1),
  ('Cocktails', 'Espresso martini', null, 1150, 260, 3, '{}', '{vegan}', 2),
  ('Cocktails', 'Spritz', null, 1000, 210, 2, '{sulphites}', '{vegan}', 3),
  ('Wine', 'House red (175ml)', null, 750, 190, 1, '{sulphites}', '{vegan}', 1),
  ('Wine', 'House white (175ml)', null, 750, 180, 1, '{sulphites}', '{vegan}', 2),
  ('Wine', 'Prosecco (125ml)', null, 850, 200, 1, '{sulphites}', '{vegan}', 3),
  ('Wine', 'Rioja Reserva (bottle)', null, 4200, 1300, 1, '{sulphites}', '{vegan}', 4),
  ('Beer & soft', 'Lager (pint)', null, 650, 160, 1, '{gluten}', '{vegan}', 1),
  ('Beer & soft', 'Pale ale (pint)', null, 680, 170, 1, '{gluten}', '{vegan}', 2),
  ('Beer & soft', 'Sparkling water (750ml)', null, 450, 60, 1, '{}', '{vegan}', 3),
  ('Beer & soft', 'Fresh lemonade', null, 400, 70, 2, '{}', '{vegan}', 4),
  ('Hot drinks', 'Espresso', null, 300, 40, 2, '{}', '{vegan}', 1),
  ('Hot drinks', 'Flat white', null, 380, 60, 3, '{milk}', '{}', 2),
  ('Hot drinks', 'Pot of tea', null, 350, 30, 2, '{}', '{vegan}', 3)
) i(cat, name, descr, price, cost, prep, allergens, dietary, ord)
join menu_categories c on c.company_id = '11111111-0000-0000-0000-000000000000' and c.name = i.cat;


insert into modifier_groups (id, company_id, name, min_select, max_select) values
  ('33333333-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000000', 'Temperature', 1, 1),
  ('33333333-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000000', 'Burger extras', 0, 3),
  ('33333333-0000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000000', 'Martini style', 0, 1);
insert into modifier_options (group_id, name, price_delta, sort_order) values
  ('33333333-0000-0000-0000-000000000001', 'Rare', 0, 1),
  ('33333333-0000-0000-0000-000000000001', 'Medium rare', 0, 2),
  ('33333333-0000-0000-0000-000000000001', 'Medium', 0, 3),
  ('33333333-0000-0000-0000-000000000001', 'Well done', 0, 4),
  ('33333333-0000-0000-0000-000000000002', 'Bacon', 200, 1),
  ('33333333-0000-0000-0000-000000000002', 'Extra cheese', 150, 2),
  ('33333333-0000-0000-0000-000000000002', 'Fried egg', 150, 3),
  ('33333333-0000-0000-0000-000000000003', 'Extra shot', 100, 1),
  ('33333333-0000-0000-0000-000000000003', 'Decaf', 0, 2);
insert into menu_item_modifier_groups (menu_item_id, group_id)
select i.id, g.gid from menu_items i
join (values ('Ribeye 10oz', '33333333-0000-0000-0000-000000000001'::uuid),
             ('House burger', '33333333-0000-0000-0000-000000000002'::uuid),
             ('Espresso martini', '33333333-0000-0000-0000-000000000003'::uuid)) g(item, gid) on g.item = i.name
where i.company_id = '11111111-0000-0000-0000-000000000000';
