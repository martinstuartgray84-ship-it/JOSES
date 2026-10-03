-- DEMO DATA ONLY: never run against a live database.
-- Generates N days of plausible history (before today) for the seeded company:
-- guests, bookings (with no-shows and cancellations), checks with per-item
-- kitchen timings (slower at weekend peaks), comps, payments and tips.
-- Deterministic: same output every run on a fresh seed.
--   psql "$DATABASE_URL" -v days=56 -f supabase/demo/history.sql

\if :{?days}
\else
  \set days 56
\endif

select setseed(0.4242);
select set_config('demo.days', :'days', false);

create or replace function pg_temp.pick(arr uuid[]) returns uuid language sql volatile as $$
  select arr[1 + floor(random() * array_length(arr, 1))::int]
$$;

-- Guests: a skewed pool so a few people visit often (regulars) and most once or twice.
insert into guests (company_id, first_name, last_name, email, phone, marketing_opt_in, created_at)
select '11111111-0000-0000-0000-000000000000',
       (array['Ana','Ben','Chloe','Dan','Ella','Finn','Grace','Harry','Isla','Jack','Kate','Liam','Maya','Noah','Olivia','Priya','Quinn','Rosa','Sam','Tara','Umar','Vera','Will','Yara','Zoe','Alex','Beth','Callum','Dev','Erin'])[1 + (g % 30)],
       (array['Smith','Jones','Taylor','Brown','Williams','Wilson','Johnson','Davies','Patel','Robinson','Wright','Thompson','Evans','Walker','White','Roberts','Green','Hall','Wood','Jackson','Clarke','Khan','Singh','Murphy','Lewis'])[1 + ((g * 7) % 25)],
       'guest' || g || '@example.com',
       case when g % 3 = 0 then null else '07700' || lpad((900000 + g)::text, 6, '0') end,
       random() < 0.55,
       now() - make_interval(days => :days + 30)
from generate_series(1, 700) g
on conflict do nothing;

do $$
declare
  days int := current_setting('demo.days')::int;
  v record; d date; dow int; svc record; slot time; tbl record;
  p float; covers int; guest uuid; booking uuid; o_id uuid; b_status booking_status;
  t0 timestamptz; t_drinks timestamptz; t_start timestamptz; t_mainsfire timestamptz; t_dessert timestamptz; t_last timestamptz; t_close timestamptz;
  peak boolean; late float; staff uuid; staff_ids uuid[]; guests uuid[];
  drinks uuid[]; starters uuid[]; mains uuid[]; sides uuid[]; desserts uuid[];
  i int; n int; it record; tk uuid; total int; tip int; lead interval; svc_pct numeric;
  item_rows jsonb;
begin
  select array_agg(id) into staff_ids from staff_members where company_id = '11111111-0000-0000-0000-000000000000';
  select array_agg(id order by email) into guests from guests where company_id = '11111111-0000-0000-0000-000000000000' and email like 'guest%@example.com';
  select array_agg(i.id) into drinks from menu_items i join menu_categories c on c.id = i.category_id where c.default_course = 0;
  select array_agg(i.id) into starters from menu_items i join menu_categories c on c.id = i.category_id where c.name = 'Small plates';
  select array_agg(i.id) into mains from menu_items i join menu_categories c on c.id = i.category_id where c.name = 'Mains';
  select array_agg(i.id) into sides from menu_items i join menu_categories c on c.id = i.category_id where c.name = 'Sides';
  select array_agg(i.id) into desserts from menu_items i join menu_categories c on c.id = i.category_id where c.name = 'Desserts';

  for v in select * from venues where company_id = '11111111-0000-0000-0000-000000000000' order by slug loop
    svc_pct := v.service_charge_pct;
    for d in select generate_series(current_date - days, current_date - 1, interval '1 day')::date loop
      dow := extract(dow from d);
      for svc in select s.* from services s where s.venue_id = v.id and dow = any(s.days_of_week) loop
        -- Fixed seatings per table keep tables from overlapping.
        foreach slot in array (case when svc.name = 'Lunch' then array['12:00','13:00','14:00']::time[] else array['17:00','19:00','21:00']::time[] end) loop
          for tbl in select * from tables t where t.venue_id = v.id loop
            -- Lunch tables turn once (12:00 or 13:00 seating), dinner up to three times.
            if svc.name = 'Lunch' and ((tbl.label::int % 2 = 0 and slot <> '12:00') or (tbl.label::int % 2 = 1 and slot <> '13:00')) then continue; end if;
            p := case
                   when svc.name = 'Lunch' then case dow when 0 then 0.75 when 6 then 0.65 else 0.35 end
                   when slot = '19:00' then case dow when 5 then 0.97 when 6 then 0.99 when 4 then 0.8 else 0.6 end
                   else case dow when 5 then 0.7 when 6 then 0.78 when 4 then 0.45 else 0.3 end
                 end * case when v.slug = 'site-two' then 0.85 else 1 end
                     * (0.85 + 0.3 * (1 - (current_date - d)::float / days));   -- gently growing
            if random() > p then continue; end if;

            covers := greatest(tbl.min_covers, least(tbl.max_covers, tbl.min_covers + floor(random() * (tbl.max_covers - tbl.min_covers + 1))::int));
            guest := guests[1 + floor(array_length(guests, 1) * power(random(), 2.3))::int];
            if random() < 0.18 then guest := null; end if;   -- walk-in
            peak := dow in (5, 6) and slot = '19:00';
            t0 := (d + slot) at time zone v.timezone + make_interval(mins => floor(random() * 35)::int);
            b_status := case when guest is null then 'completed'
                           when random() < 0.045 then 'no_show'
                           when random() < 0.07 then 'cancelled'
                           else 'completed' end;

            booking := null;
            if guest is not null then
              lead := make_interval(hours => floor(2 + 24 * 30 * power(random(), 2.5))::int);
              insert into bookings (venue_id, service_id, guest_id, covers, starts_at, duration_minutes, buffer_minutes, status, channel, created_at)
              values (v.id, svc.id, guest, covers, (d + slot) at time zone v.timezone, 105, 15, 'confirmed',
                      (array['online','online','online','online','phone','phone','staff'])[1 + floor(random() * 7)::int]::booking_channel,
                      (d + slot) at time zone v.timezone - lead)
              returning id into booking;
              insert into booking_tables (booking_id, table_id) values (booking, tbl.id);
            end if;
            if b_status <> 'completed' then
              update bookings set status = b_status where id = booking;
              continue;
            end if;

            staff := pg_temp.pick(staff_ids);
            insert into orders (venue_id, table_id, table_label, booking_id, guest_id, covers, status, opened_by, opened_at, service_charge_pct)
            values (v.id, tbl.id, tbl.label, booking, guest, covers, 'open', staff, t0, svc_pct)
            returning id into o_id;

            late := case when peak then random() * 9 else power(random(), 3) * 3.5 end;
            -- Drinks: one or two each.
            t_drinks := t0 + make_interval(mins => 2 + floor(random() * 4)::int);
            for i in 1 .. covers + floor(random() * covers)::int loop
              insert into order_items (order_id, venue_id, menu_item_id, name, unit_price, quantity, cost, course, station, prep_minutes, seat, status, added_by, created_at, sent_at, started_at, ready_at, served_at)
              select o_id, v.id, m.id, m.name, m.price, 1, m.cost, 0, 'bar', m.prep_minutes, 1 + (i - 1) % covers, 'served', staff,
                     t_drinks, t_drinks, t_drinks + interval '1 minute',
                     t_drinks + make_interval(secs => (m.prep_minutes + 1 + random() * (case when peak then 7 else 3 end)) * 60),
                     t_drinks + make_interval(secs => (m.prep_minutes + 1 + random() * (case when peak then 7 else 3 end)) * 60)
              from menu_items m where m.id = (select pg_temp.pick(drinks));
            end loop;

            -- Starters for about two thirds of guests.
            t_start := t0 + make_interval(mins => 9 + floor(random() * 6)::int);
            t_last := t_start;
            for i in 1 .. covers loop
              if random() < 0.65 then
                insert into order_items (order_id, venue_id, menu_item_id, name, unit_price, quantity, cost, course, station, prep_minutes, seat, status, added_by, created_at, sent_at, started_at, ready_at, served_at)
                select o_id, v.id, m.id, m.name, m.price, 1, m.cost, 1, 'kitchen', m.prep_minutes, i, 'served', staff,
                       t_start, t_start, t_start + make_interval(mins => floor(random() * 2)::int),
                       t_start + make_interval(secs => (m.prep_minutes + late * 0.6 + random() * 0.8) * 60),
                       t_start + make_interval(secs => (m.prep_minutes + late * 0.6 + random() * 0.8 + 1 + random() * (case when peak then 4 else 1.5 end)) * 60)
                from menu_items m where m.id = (select pg_temp.pick(starters));
              end if;
            end loop;
            select coalesce(max(served_at), t_start) into t_last from order_items where order_items.order_id = o_id and course = 1;

            -- Mains fired when starters are cleared; cook-to-sync, so all ready together.
            t_mainsfire := t_last + make_interval(mins => 10 + floor(random() * 10)::int);
            for i in 1 .. covers loop
              insert into order_items (order_id, venue_id, menu_item_id, name, unit_price, quantity, cost, course, station, prep_minutes, seat, status, added_by, created_at, sent_at, started_at, ready_at, served_at, modifiers, modifiers_total)
              select o_id, v.id, m.id, m.name, m.price, 1, m.cost, 2, 'kitchen', m.prep_minutes, i, 'served', staff,
                     t_start, t_mainsfire, t_mainsfire + make_interval(secs => late * 0.7 * 60),
                     t_mainsfire + make_interval(secs => (m.prep_minutes + late + random() * 0.8) * 60),
                     t_mainsfire + make_interval(secs => (m.prep_minutes + late + random() * 0.8 + 1 + random() * (case when peak then 5 else 1.5 end)) * 60),
                     case when m.name like 'Ribeye%' then '[{"group":"Temperature","option":"Medium rare","priceDelta":0}]'::jsonb else '[]'::jsonb end, 0
              from menu_items m where m.id = (select pg_temp.pick(mains));
              if random() < 0.45 then
                insert into order_items (order_id, venue_id, menu_item_id, name, unit_price, quantity, cost, course, station, prep_minutes, status, added_by, created_at, sent_at, started_at, ready_at, served_at)
                select o_id, v.id, m.id, m.name, m.price, 1, m.cost, 2, 'kitchen', m.prep_minutes, 'served', staff,
                       t_start, t_mainsfire, t_mainsfire + make_interval(secs => late * 0.7 * 60),
                       t_mainsfire + make_interval(secs => (m.prep_minutes + late + random() * 0.8) * 60),
                       t_mainsfire + make_interval(secs => (m.prep_minutes + late + random() * 0.8 + 2) * 60)
                from menu_items m where m.id = (select pg_temp.pick(sides));
              end if;
            end loop;
            select max(served_at) into t_last from order_items where order_items.order_id = o_id;

            -- Second round of drinks with mains for some tables.
            if random() < 0.6 then
              insert into order_items (order_id, venue_id, menu_item_id, name, unit_price, quantity, cost, course, station, prep_minutes, status, added_by, created_at, sent_at, started_at, ready_at, served_at)
              select o_id, v.id, m.id, m.name, m.price, greatest(1, covers / 2), m.cost, 0, 'bar', m.prep_minutes, 'served', staff,
                     t_mainsfire, t_mainsfire, t_mainsfire + interval '1 minute',
                     t_mainsfire + make_interval(secs => (m.prep_minutes + 2 + random() * (case when peak then 9 else 3 end)) * 60),
                     t_mainsfire + make_interval(secs => (m.prep_minutes + 2 + random() * (case when peak then 9 else 3 end)) * 60)
              from menu_items m where m.id = (select pg_temp.pick(drinks));
            end if;

            -- Desserts for about two in five.
            t_dessert := t_last + make_interval(mins => 12 + floor(random() * 10)::int);
            for i in 1 .. covers loop
              if random() < 0.4 then
                insert into order_items (order_id, venue_id, menu_item_id, name, unit_price, quantity, cost, course, station, prep_minutes, seat, status, added_by, created_at, sent_at, started_at, ready_at, served_at)
                select o_id, v.id, m.id, m.name, m.price, 1, m.cost, 3, 'kitchen', m.prep_minutes, i, 'served', staff,
                       t_dessert, t_dessert, t_dessert + interval '1 minute',
                       t_dessert + make_interval(secs => (m.prep_minutes + late * 0.4 + random() * 1.5) * 60),
                       t_dessert + make_interval(secs => (m.prep_minutes + late * 0.4 + random() * 1.5 + 1 + random() * 2) * 60)
                from menu_items m where m.id = (select pg_temp.pick(desserts));
              end if;
            end loop;

            -- Now and then a comp or a void.
            if random() < 0.04 then
              update order_items set comped = true, comp_reason = (array['Long wait','Birthday','Regular','Dish sent back'])[1 + floor(random() * 4)::int]
              where id = (select id from order_items where order_items.order_id = o_id order by random() limit 1);
            end if;
            if random() < 0.03 then
              update order_items set status = 'void', void_reason = (array['Wrong item','Customer changed mind','Kitchen error'])[1 + floor(random() * 3)::int], voided_at = sent_at
              where id = (select id from order_items where order_items.order_id = o_id and course > 0 order by random() limit 1);
            end if;

            -- Tickets: one per station and course, as the till would have made them.
            for it in select station, course, min(sent_at) as fired, max(ready_at) as bumped from order_items
                      where order_items.order_id = o_id group by station, course loop
              insert into tickets (venue_id, order_id, station, course, fired_at, bumped_at)
              values (v.id, o_id, it.station, it.course, it.fired, it.bumped) returning id into tk;
              update order_items set ticket_id = tk where order_items.order_id = o_id and station = it.station and course = it.course;
            end loop;

            select max(served_at) into t_last from order_items where order_items.order_id = o_id;
            t_close := t_last + make_interval(mins => 10 + floor(random() * 25)::int);
            select coalesce(sum((unit_price + modifiers_total) * quantity) filter (where status <> 'void' and not comped), 0)
              into total from order_items where order_items.order_id = o_id;
            total := total + round(total * svc_pct / 100);
            tip := case when random() < 0.25 then (1 + floor(random() * 5)::int) * 100 else 0 end;
            if random() < 0.12 and covers > 1 then
              insert into order_payments (order_id, venue_id, method, amount, tip, taken_by, created_at)
              values (o_id, v.id, 'card', total / 2, tip, staff, t_close),
                     (o_id, v.id, 'card', total - total / 2, 0, staff, t_close);
            else
              insert into order_payments (order_id, venue_id, method, amount, tip, taken_by, created_at)
              values (o_id, v.id, case when random() < 0.08 then 'cash'::payment_method else 'card' end, total, tip, staff, t_close);
            end if;
            update orders o set status = 'paid', closed_at = t_close,
                   total_gross = total,
                   total_service = round((total::numeric * svc_pct) / (100 + svc_pct)),
                   total_vat = round((total - round((total::numeric * svc_pct) / (100 + svc_pct))) / 6.0),
                   total_discount = 0
             where o.id = o_id;
            if booking is not null then
              update bookings set status = 'completed',
                     duration_minutes = greatest(30, least(105, ceil(extract(epoch from t_close - starts_at) / 60)::int))
               where id = booking;
            end if;
          end loop;
        end loop;
      end loop;
    end loop;
  end loop;
end $$;
