// Live floor: every open table run through the table coach, with benchmarks
// learned from the site's own history.

import type { Sql } from "postgres";
import { coachTable, DEFAULT_BENCHMARK, itemKind, rankTables, type Benchmark, type CoachItem, type CoachResult } from "../tables/coach";
import type { Site } from "./booking";

const BUCKETS = [0, 10, 20, 30, 45, 60, 75, 90, 105, 120, 150];
const HISTORY_DAYS = 56;
const MIN_CHECKS = 20;
const CACHE_MS = 10 * 60_000;

/** SQL that mirrors itemKind() so history and live tables classify items the same way. */
const KIND_SQL = `case
  when coalesce(c.name, '') ~* '(coffee|tea|hot drink|espresso|digestif)' then 'hot'
  when i.course <> 0 then 'food'
  when coalesce(c.name, '') ~* '(wine|fizz|champagne|sparkling|bubbles|prosecco)' then 'wine'
  else 'drink' end`;

const cache = new Map<string, { at: number; value: Benchmark }>();

export type Daypart = "lunch" | "dinner";
export const daypartOf = (localHour: number): Daypart => (localHour < 16 ? "lunch" : "dinner");

/**
 * What tables like this usually do at this site: spend curve, final spend,
 * dwell, average prices and attach rates over the last 8 weeks. Falls back to
 * sensible defaults until there's enough history.
 */
export async function siteBenchmark(sql: Sql, site: Site, daypart: Daypart, now = new Date()): Promise<Benchmark> {
  const key = `${site.id}:${daypart}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;

  const since = new Date(now.getTime() - HISTORY_DAYS * 86_400_000);
  const lunch = daypart === "lunch";
  const orders = sql`
    select o.id, o.covers, o.opened_at, o.closed_at, o.total_gross - coalesce(o.total_service, 0) as sales
    from orders o
    where o.venue_id = ${site.id} and o.status = 'paid' and o.closed_at > ${since} and o.covers > 0
      and (extract(hour from o.opened_at at time zone ${site.timezone}) < 16) = ${lunch}`;
  const [base] = await sql`
    with o as (${orders})
    select count(*)::int as n,
           percentile_cont(0.5) within group (order by sales::float / covers) as final_per_head,
           percentile_cont(0.5) within group (order by extract(epoch from closed_at - opened_at) / 60) as dwell
    from o`;
  if (!base || base.n < MIN_CHECKS) {
    cache.set(key, { at: Date.now(), value: DEFAULT_BENCHMARK });
    return DEFAULT_BENCHMARK;
  }
  const curve = await sql`
    with o as (${orders}), b as (select unnest(${BUCKETS}::int[]) as m)
    select b.m, percentile_cont(0.5) within group (order by per_head) as per_head from (
      select b.m, o.id,
             coalesce(sum((i.unit_price + i.modifiers_total) * i.quantity)
                      filter (where i.created_at <= o.opened_at + make_interval(mins => b.m)), 0)::float / o.covers as per_head
      from o cross join b
      left join order_items i on i.order_id = o.id and i.status <> 'void' and not i.comped
      group by b.m, o.id, o.covers
    ) x join b using (m) group by b.m order by b.m`;
  const [mix] = await sql.unsafe(
    `with o as (
       select o.id, o.covers from orders o
       where o.venue_id = $1 and o.status = 'paid' and o.closed_at > $2 and o.covers > 0
         and (extract(hour from o.opened_at at time zone $3) < 16) = $4
     ), lines as (
       select o.id as order_id, o.covers, i.course, i.quantity, i.created_at,
              (i.unit_price + i.modifiers_total) as price, ${KIND_SQL} as kind
       from o join order_items i on i.order_id = o.id left join menu_items mi on mi.id = i.menu_item_id
       left join menu_categories c on c.id = mi.category_id
       where i.status <> 'void'
     ), per_order as (
       select order_id, max(covers) as covers,
              sum(quantity) filter (where kind = 'food' and course = 3) as desserts,
              sum(quantity) filter (where kind = 'food' and course = 1) as starters,
              sum(quantity) filter (where kind = 'hot') as hot,
              bool_or(kind = 'wine') as wine,
              (max(created_at) filter (where kind in ('drink', 'wine')) - min(created_at) filter (where kind in ('drink', 'wine')))
                > interval '10 minutes' as second_round
       from lines group by order_id
     )
     select
       (select avg(price) from lines where kind = 'drink') as drink,
       (select avg(price) from lines where kind = 'wine') as wine,
       (select avg(price) from lines where kind = 'hot') as hot,
       (select avg(price) from lines where kind = 'food' and course = 3) as dessert,
       (select avg(price) from lines where kind = 'food' and course = 1) as starter,
       (select avg(case when second_round then 1.0 else 0 end) from per_order) as second_round,
       (select sum(coalesce(desserts, 0))::float / nullif(sum(covers), 0) from per_order) as dessert_attach,
       (select sum(coalesce(starters, 0))::float / nullif(sum(covers), 0) from per_order) as starter_attach,
       (select sum(coalesce(hot, 0))::float / nullif(sum(covers), 0) from per_order) as hot_attach,
       (select avg(case when wine then 1.0 else 0 end) from per_order) as wine_attach`,
    [site.id, since, site.timezone, lunch],
  );
  const d = DEFAULT_BENCHMARK;
  const num = (v: unknown, fallback: number) => (v === null || v === undefined || Number.isNaN(Number(v)) ? fallback : Number(v));
  const value: Benchmark = {
    spendCurve: curve.map((c) => [c.m as number, Math.round(c.per_head)] as [number, number]),
    finalPerHead: Math.round(base.final_per_head),
    dwellMinutes: Math.round(base.dwell),
    avgPrice: {
      drink: Math.round(num(mix?.drink, d.avgPrice.drink)),
      wine: Math.round(num(mix?.wine, d.avgPrice.wine)),
      hot: Math.round(num(mix?.hot, d.avgPrice.hot)),
      dessert: Math.round(num(mix?.dessert, d.avgPrice.dessert)),
      starter: Math.round(num(mix?.starter, d.avgPrice.starter)),
    },
    attach: {
      secondRound: num(mix?.second_round, d.attach.secondRound),
      dessert: Math.min(1, num(mix?.dessert_attach, d.attach.dessert)),
      starter: Math.min(1, num(mix?.starter_attach, d.attach.starter)),
      hot: Math.min(1, num(mix?.hot_attach, d.attach.hot)),
      wine: num(mix?.wine_attach, d.attach.wine),
    },
  };
  cache.set(key, { at: Date.now(), value });
  return value;
}

export function clearBenchmarkCache() {
  cache.clear();
}

export interface FloorTableView {
  orderId: string;
  tableId: string | null;
  label: string;
  seats: number;
  covers: number;
  server: string | null;
  guestName: string | null;
  guestVisits: number;
  allergies: string | null;
  openedAt: Date;
  result: CoachResult;
}

export interface FloorView {
  tables: FloorTableView[];
  benchmark: { lunch: Benchmark; dinner: Benchmark };
  totals: { tables: number; covers: number; spend: number; projected: number; opportunity: number; urgent: number };
}

/** Every open check at the site, coached and ranked. */
export async function liveFloor(sql: Sql, site: Site, now = new Date()): Promise<FloorView> {
  const [lunch, dinner] = await Promise.all([siteBenchmark(sql, site, "lunch", now), siteBenchmark(sql, site, "dinner", now)]);
  const orders = await sql`
    select o.id, o.table_id, coalesce(o.table_label, 'Tab') as label, o.covers, o.opened_at, o.guest_id,
           coalesce(t.max_covers, o.covers) as seats, s.name as server,
           nullif(trim(concat_ws(' ', g.first_name, g.last_name)), '') as guest_name, g.first_name, g.allergies,
           coalesce(gs.visits, 0)::int as visits,
           b.starts_at + make_interval(mins => b.booked_duration_minutes) as planned_end,
           extract(hour from o.opened_at at time zone ${site.timezone})::int as local_hour
    from orders o
    left join tables t on t.id = o.table_id
    left join staff_members s on s.id = o.opened_by
    left join guests g on g.id = o.guest_id
    left join guest_stats gs on gs.guest_id = o.guest_id
    left join bookings b on b.id = o.booking_id
    where o.venue_id = ${site.id} and o.status = 'open'`;
  if (orders.length === 0) {
    return { tables: [], benchmark: { lunch, dinner }, totals: { tables: 0, covers: 0, spend: 0, projected: 0, opportunity: 0, urgent: 0 } };
  }
  const ids = orders.map((o) => o.id as string);
  const tableIds = orders.map((o) => o.table_id as string | null).filter((x): x is string => !!x);
  const guestIds = orders.map((o) => o.guest_id as string | null).filter((x): x is string => !!x);
  const [items, nextBookings, favourites] = await Promise.all([
    sql.unsafe(
      `select i.order_id, i.name, i.course, i.quantity, i.status::text as status, i.created_at, i.sent_at, i.served_at,
              case when i.comped then 0 else (i.unit_price + i.modifiers_total) * i.quantity end as value,
              ${KIND_SQL} as kind
       from order_items i left join menu_items mi on mi.id = i.menu_item_id left join menu_categories c on c.id = mi.category_id
       where i.order_id = any($1::uuid[])`,
      [ids],
    ),
    tableIds.length
      ? sql`
          select distinct on (bt.table_id) bt.table_id, b.starts_at, b.covers,
                 coalesce(nullif(trim(concat_ws(' ', g.first_name, g.last_name)), ''), 'Walk-in') as name
          from bookings b join booking_tables bt on bt.booking_id = b.id left join guests g on g.id = b.guest_id
          where bt.table_id in ${sql(tableIds)} and b.status in ('pending', 'confirmed') and b.starts_at > ${now}
          order by bt.table_id, b.starts_at`
      : Promise.resolve([]),
    guestIds.length
      ? sql`
          select x.guest_id,
                 (array_agg(x.name order by x.n desc) filter (where x.course = 0))[1] as drink,
                 (array_agg(x.name order by x.n desc) filter (where x.course = 3))[1] as dessert
          from (select o.guest_id, i.name, i.course, sum(i.quantity) as n
                from orders o join order_items i on i.order_id = o.id
                where o.guest_id in ${sql(guestIds)} and o.status = 'paid' and i.status <> 'void'
                group by o.guest_id, i.name, i.course) x
          group by x.guest_id`
      : Promise.resolve([]),
  ]);
  const nextBy = new Map(nextBookings.map((n) => [n.table_id as string, n]));
  const favBy = new Map(favourites.map((f) => [f.guest_id as string, f]));

  const tables: FloorTableView[] = orders.map((o) => {
    const daypart = daypartOf(o.local_hour);
    const its: CoachItem[] = items
      .filter((i) => i.order_id === o.id)
      .map((i) => ({
        name: i.name,
        kind: (i.kind as CoachItem["kind"]) ?? itemKind(i.course, null),
        course: i.course,
        quantity: i.quantity,
        status: i.status,
        createdAt: i.created_at,
        sentAt: i.sent_at,
        servedAt: i.served_at,
        value: Number(i.value),
      }));
    const next = o.table_id ? nextBy.get(o.table_id) : undefined;
    const fav = o.guest_id ? favBy.get(o.guest_id) : undefined;
    const result = coachTable(
      {
        tableId: o.table_id,
        label: o.label,
        seats: o.seats,
        covers: o.covers,
        openedAt: o.opened_at,
        plannedEnd: o.planned_end,
        nextBooking: next ? { start: next.starts_at, covers: next.covers, name: next.name } : null,
        items: its,
        guest: o.guest_id
          ? { name: o.first_name ?? "They", visits: o.visits, favouriteDrink: fav?.drink ?? null, favouriteDessert: fav?.dessert ?? null, allergies: o.allergies }
          : null,
        daypart,
      },
      daypart === "lunch" ? lunch : dinner,
      now,
    );
    return {
      orderId: o.id,
      tableId: o.table_id,
      label: o.label,
      seats: o.seats,
      covers: o.covers,
      server: o.server,
      guestName: o.guest_name,
      guestVisits: o.visits,
      allergies: o.allergies,
      openedAt: o.opened_at,
      result,
    };
  });
  const ranked = rankTables(tables);
  return {
    tables: ranked,
    benchmark: { lunch, dinner },
    totals: {
      tables: ranked.length,
      covers: ranked.reduce((n, t) => n + t.covers, 0),
      spend: ranked.reduce((n, t) => n + t.result.spend, 0),
      projected: ranked.reduce((n, t) => n + t.result.projectedTotal, 0),
      opportunity: ranked.reduce((n, t) => n + t.result.opportunity, 0),
      urgent: ranked.filter((t) => t.result.nudges[0]?.priority === 1).length,
    },
  };
}
