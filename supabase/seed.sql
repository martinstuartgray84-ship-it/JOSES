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
