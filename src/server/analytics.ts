// Owner metrics. One function per dashboard section, all over a local-date
// range [from, to] (inclusive) and optionally one site. Money in pence.
//
// Definitions (shown on the dashboard too):
//   Sales        what guests paid for food and drink, inc VAT, after discounts; excludes service and tips
//   Covers       guests on paid checks
//   Spend/head   sales ÷ covers
//   Drinks time  order taken → drink served
//   Food time    course fired → plate served
//   Kitchen time course fired → plate ready on the pass
//   Pass wait    plate ready → served (food going cold)
//   Late ticket  food ticket ready more than 2 min after its target (fired + longest prep)

import type { Sql } from "postgres";

export interface Range {
  companyId: string;
  /** Restrict to these sites; empty = all. */
  siteIds: string[];
  from: string; // YYYY-MM-DD local
  to: string; // YYYY-MM-DD local, inclusive
  timezone: string;
}

const median = (col: string) => `percentile_cont(0.5) within group (order by ${col})`;

/** Same-length period immediately before the range, for deltas. */
export function previousRange(r: Range): Range {
  const from = new Date(`${r.from}T12:00:00Z`);
  const to = new Date(`${r.to}T12:00:00Z`);
  const days = Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
  const pTo = new Date(from.getTime() - 86_400_000);
  const pFrom = new Date(pTo.getTime() - (days - 1) * 86_400_000);
  return { ...r, from: pFrom.toISOString().slice(0, 10), to: pTo.toISOString().slice(0, 10) };
}

function scope(sql: Sql, r: Range, alias = "o", timeCol = "closed_at") {
  const start = sql`(${r.from}::date)::timestamp at time zone ${r.timezone}`;
  const end = sql`(${r.to}::date + 1)::timestamp at time zone ${r.timezone}`;
  const sites = r.siteIds.length
    ? sql`and ${sql(alias)}.venue_id in ${sql(r.siteIds)}`
    : sql`and ${sql(alias)}.venue_id in (select id from venues where company_id = ${r.companyId})`;
  return sql`${sql(alias)}.${sql(timeCol)} >= ${start} and ${sql(alias)}.${sql(timeCol)} < ${end} ${sites}`;
}

export interface Summary {
  sales: number;
  netSales: number;
  service: number;
  tips: number;
  checks: number;
  covers: number;
  spendPerHead: number;
  tableMinutes: number | null;
  discounts: number;
  comps: number;
  voids: number;
  drinksMinutes: number | null;
  foodMinutes: number | null;
  lateTicketShare: number | null;
}

export async function summary(sql: Sql, r: Range): Promise<Summary> {
  const [money] = await sql`
    select coalesce(sum(o.total_gross - coalesce(o.total_service, 0)), 0)::bigint as sales,
           coalesce(sum(o.total_gross - coalesce(o.total_service, 0) - coalesce(o.total_vat, 0)), 0)::bigint as net_sales,
           coalesce(sum(o.total_service), 0)::bigint as service,
           coalesce(sum(o.total_discount), 0)::bigint as discounts,
           count(*)::int as checks,
           coalesce(sum(o.covers), 0)::int as covers,
           ${sql.unsafe(median("extract(epoch from o.closed_at - o.opened_at) / 60"))} as table_minutes
    from orders o where o.status = 'paid' and ${scope(sql, r)}`;
  const [extra] = await sql`
    select coalesce((select sum(p.tip) from order_payments p join orders o on o.id = p.order_id
                     where o.status = 'paid' and ${scope(sql, r)}), 0)::bigint as tips,
           coalesce((select sum((i.unit_price + i.modifiers_total) * i.quantity) from order_items i join orders o on o.id = i.order_id
                     where i.comped and i.status <> 'void' and ${scope(sql, r)}), 0)::bigint as comps,
           coalesce((select sum((i.unit_price + i.modifiers_total) * i.quantity) from order_items i join orders o on o.id = i.order_id
                     where i.status = 'void' and ${scope(sql, r)}), 0)::bigint as voids`;
  const [speed] = await sql`
    select ${sql.unsafe(median("extract(epoch from i.served_at - i.created_at) / 60"))} filter (where i.course = 0) as drinks,
           ${sql.unsafe(median("extract(epoch from i.served_at - i.sent_at) / 60"))} filter (where i.course > 0) as food
    from order_items i join orders o on o.id = i.order_id
    where i.served_at is not null and i.status = 'served' and ${scope(sql, r)}`;
  const [late] = await sql`
    select avg(case when t.bumped_at > t.fired_at + make_interval(mins => mx.prep + 2) then 1.0 else 0.0 end) as share
    from tickets t join orders o on o.id = t.order_id
    join lateral (select max(prep_minutes) as prep from order_items i where i.ticket_id = t.id and i.status <> 'void') mx on true
    where t.course > 0 and t.bumped_at is not null and ${scope(sql, r)}`;
  const sales = Number(money!.sales);
  const covers = money!.covers;
  return {
    sales,
    netSales: Number(money!.net_sales),
    service: Number(money!.service),
    tips: Number(extra!.tips),
    checks: money!.checks,
    covers,
    spendPerHead: covers ? Math.round(sales / covers) : 0,
    tableMinutes: money!.table_minutes === null ? null : Math.round(money!.table_minutes),
    discounts: Number(money!.discounts),
    comps: Number(extra!.comps),
    voids: Number(extra!.voids),
    drinksMinutes: speed!.drinks === null ? null : Math.round(speed!.drinks * 10) / 10,
    foodMinutes: speed!.food === null ? null : Math.round(speed!.food * 10) / 10,
    lateTicketShare: late!.share === null ? null : Number(late!.share),
  };
}

export interface DailyRow {
  date: string;
  siteId: string;
  sales: number;
  covers: number;
}

export async function daily(sql: Sql, r: Range): Promise<DailyRow[]> {
  const rows = await sql`
    select to_char((o.closed_at at time zone ${r.timezone})::date, 'YYYY-MM-DD') as date, o.venue_id,
           sum(o.total_gross - coalesce(o.total_service, 0))::bigint as sales, sum(o.covers)::int as covers
    from orders o where o.status = 'paid' and ${scope(sql, r)}
    group by 1, 2 order by 1`;
  return rows.map((x) => ({ date: x.date, siteId: x.venue_id, sales: Number(x.sales), covers: x.covers }));
}

export interface HourSpeed {
  hour: number;
  drinks: number | null;
  food: number | null;
  items: number;
}

export async function speedByHour(sql: Sql, r: Range): Promise<HourSpeed[]> {
  const rows = await sql`
    select extract(hour from i.sent_at at time zone ${r.timezone})::int as hour,
           ${sql.unsafe(median("extract(epoch from i.served_at - i.created_at) / 60"))} filter (where i.course = 0) as drinks,
           ${sql.unsafe(median("extract(epoch from i.served_at - i.sent_at) / 60"))} filter (where i.course > 0) as food,
           count(*)::int as items
    from order_items i join orders o on o.id = i.order_id
    where i.status = 'served' and i.served_at is not null and ${scope(sql, r)}
    group by 1 order by 1`;
  return rows.map((x) => ({
    hour: x.hour,
    drinks: x.drinks === null ? null : Math.round(x.drinks * 10) / 10,
    food: x.food === null ? null : Math.round(x.food * 10) / 10,
    items: x.items,
  }));
}

export interface StageTimes {
  kitchen: number | null;
  pass: number | null;
  bar: number | null;
}

export async function stageTimes(sql: Sql, r: Range): Promise<StageTimes> {
  const [x] = await sql`
    select ${sql.unsafe(median("extract(epoch from i.ready_at - i.sent_at) / 60"))} filter (where i.course > 0) as kitchen,
           ${sql.unsafe(median("extract(epoch from i.served_at - i.ready_at) / 60"))} filter (where i.course > 0) as pass,
           ${sql.unsafe(median("extract(epoch from i.ready_at - i.sent_at) / 60"))} filter (where i.course = 0) as bar
    from order_items i join orders o on o.id = i.order_id
    where i.status = 'served' and i.ready_at is not null and ${scope(sql, r)}`;
  const round = (v: number | null) => (v === null ? null : Math.round(v * 10) / 10);
  return { kitchen: round(x!.kitchen), pass: round(x!.pass), bar: round(x!.bar) };
}

export interface DishSpeed {
  name: string;
  count: number;
  prepMinutes: number;
  medianMinutes: number;
  overBy: number;
}

/**
 * Dishes whose actual cooking time (started → ready) most exceeds the prep time
 * on the menu. Fire → ready would wrongly flag quick sides that are held back on
 * purpose so they finish with the mains.
 */
export async function slowDishes(sql: Sql, r: Range, limit = 8): Promise<DishSpeed[]> {
  const rows = await sql`
    select i.name, count(*)::int as n, round(avg(i.prep_minutes))::int as prep,
           ${sql.unsafe(median("extract(epoch from i.ready_at - i.started_at) / 60"))} as med
    from order_items i join orders o on o.id = i.order_id
    where i.course > 0 and i.status = 'served' and i.started_at is not null and i.ready_at > i.started_at and ${scope(sql, r)}
    group by i.name having count(*) >= 5
    order by (${sql.unsafe(median("extract(epoch from i.ready_at - i.started_at) / 60"))} - avg(i.prep_minutes)) desc
    limit ${limit}`;
  return rows.map((x) => ({
    name: x.name,
    count: x.n,
    prepMinutes: x.prep,
    medianMinutes: Math.round(x.med * 10) / 10,
    overBy: Math.round((x.med - x.prep) * 10) / 10,
  }));
}

export type MenuClass = "star" | "plowhorse" | "puzzle" | "dog";

export interface MenuEngineeringRow {
  name: string;
  group: "food" | "drink";
  sold: number;
  revenue: number;
  /** Per unit, ex VAT, minus cost. Null without a cost. */
  unitMargin: number | null;
  totalMargin: number | null;
  mix: number;
  class: MenuClass | null;
}

/**
 * Kasavana–Smith menu engineering, food and drinks judged separately:
 * popular = sold share ≥ 70% of an even share; profitable = unit margin ≥ the
 * group's weighted average. Items without a cost can't be classed.
 */
export async function menuEngineering(sql: Sql, r: Range): Promise<MenuEngineeringRow[]> {
  const rows = await sql`
    select i.name, (i.course = 0) as drink, sum(i.quantity)::int as sold,
           sum((i.unit_price + i.modifiers_total) * i.quantity)::bigint as revenue,
           avg((i.unit_price + i.modifiers_total) / (1 + i.vat_rate / 100) - i.cost) as unit_margin,
           bool_and(i.cost is not null) as has_cost
    from order_items i join orders o on o.id = i.order_id
    where i.status <> 'void' and not i.comped and o.status = 'paid' and ${scope(sql, r)}
    group by i.name, (i.course = 0)`;
  const out: MenuEngineeringRow[] = [];
  for (const group of ["food", "drink"] as const) {
    const list = rows.filter((x) => x.drink === (group === "drink"));
    const totalSold = list.reduce((n, x) => n + x.sold, 0);
    const costed = list.filter((x) => x.has_cost);
    const avgMargin = costed.reduce((n, x) => n + Number(x.unit_margin) * x.sold, 0) / Math.max(1, costed.reduce((n, x) => n + x.sold, 0));
    const popularAt = list.length ? (1 / list.length) * 0.7 : 0;
    for (const x of list) {
      const mix = totalSold ? x.sold / totalSold : 0;
      const raw = x.has_cost ? Number(x.unit_margin) : null;
      const unitMargin = raw === null ? null : Math.round(raw);
      const popular = mix >= popularAt;
      // Compare unrounded: an item at exactly the average counts as profitable.
      const profitable = raw !== null && raw >= avgMargin - 1e-9;
      out.push({
        name: x.name,
        group,
        sold: x.sold,
        revenue: Number(x.revenue),
        unitMargin,
        totalMargin: unitMargin === null ? null : unitMargin * x.sold,
        mix,
        class: unitMargin === null ? null : popular ? (profitable ? "star" : "plowhorse") : profitable ? "puzzle" : "dog",
      });
    }
  }
  return out.sort((a, b) => b.sold - a.sold);
}

export interface StaffRow {
  name: string;
  checks: number;
  covers: number;
  sales: number;
  spendPerHead: number;
  tips: number;
}

export async function staffPerformance(sql: Sql, r: Range): Promise<StaffRow[]> {
  const rows = await sql`
    select s.name, count(o.id)::int as checks, sum(o.covers)::int as covers,
           sum(o.total_gross - coalesce(o.total_service, 0))::bigint as sales,
           coalesce((select sum(p.tip) from order_payments p join orders o2 on o2.id = p.order_id
                     where p.taken_by = s.id and o2.status = 'paid' and ${scope(sql, r, "o2")}), 0)::bigint as tips
    from orders o join staff_members s on s.id = o.opened_by
    where o.status = 'paid' and ${scope(sql, r)}
    group by s.id, s.name order by sales desc`;
  return rows.map((x) => ({
    name: x.name,
    checks: x.checks,
    covers: x.covers,
    sales: Number(x.sales),
    spendPerHead: x.covers ? Math.round(Number(x.sales) / x.covers) : 0,
    tips: Number(x.tips),
  }));
}

export interface BookingStats {
  bookings: number;
  completed: number;
  noShows: number;
  cancelled: number;
  coversBooked: number;
  noShowRate: number | null;
  medianLeadDays: number | null;
  byChannel: { channel: string; bookings: number }[];
  walkInShare: number | null;
}

export async function bookingStats(sql: Sql, r: Range): Promise<BookingStats> {
  const [b] = await sql`
    select count(*)::int as total,
           count(*) filter (where b.status in ('completed', 'seated'))::int as completed,
           count(*) filter (where b.status = 'no_show')::int as no_shows,
           count(*) filter (where b.status = 'cancelled')::int as cancelled,
           coalesce(sum(b.covers) filter (where b.status <> 'cancelled'), 0)::int as covers,
           ${sql.unsafe(median("extract(epoch from b.starts_at - b.created_at) / 86400"))} as lead
    from bookings b where ${scope(sql, r, "b", "starts_at")}`;
  const channels = await sql`
    select b.channel::text as channel, count(*)::int as n from bookings b
    where b.status <> 'cancelled' and ${scope(sql, r, "b", "starts_at")} group by 1 order by 2 desc`;
  const [w] = await sql`
    select avg(case when o.booking_id is null then 1.0 else 0.0 end) as walkin
    from orders o where o.status = 'paid' and ${scope(sql, r)}`;
  const decided = b!.completed + b!.no_shows;
  return {
    bookings: b!.total,
    completed: b!.completed,
    noShows: b!.no_shows,
    cancelled: b!.cancelled,
    coversBooked: b!.covers,
    noShowRate: decided ? b!.no_shows / decided : null,
    medianLeadDays: b!.lead === null ? null : Math.round(b!.lead * 10) / 10,
    byChannel: channels.map((c) => ({ channel: c.channel, bookings: c.n })),
    walkInShare: w!.walkin === null ? null : Number(w!.walkin),
  };
}

export interface GuestStats {
  /** Known guests with a paid visit in the range. */
  guests: number;
  /** Of those, whose first ever visit was in the range. */
  newGuests: number;
  /** Of those, who have visited two or more times (ever, up to the range end). */
  returning: number;
  repeatRate: number | null;
  top: { id: string; name: string; visits: number; spend: number }[];
}

export async function guestStats(sql: Sql, r: Range): Promise<GuestStats> {
  const start = sql`(${r.from}::date)::timestamp at time zone ${r.timezone}`;
  const end = sql`(${r.to}::date + 1)::timestamp at time zone ${r.timezone}`;
  const [g] = await sql`
    with inr as (
      select distinct o.guest_id from orders o where o.status = 'paid' and o.guest_id is not null and ${scope(sql, r)}
    ), hist as (
      select inr.guest_id, count(p.id) as visits, min(p.closed_at) as first_visit
      from inr join orders p on p.guest_id = inr.guest_id and p.status = 'paid' and p.closed_at < ${end}
      group by inr.guest_id
    )
    select count(*)::int as guests,
           count(*) filter (where visits >= 2)::int as returning,
           count(*) filter (where first_visit >= ${start})::int as new_guests
    from hist`;
  const top = await sql`
    select g.id, trim(concat_ws(' ', g.first_name, g.last_name)) as name, count(o.id)::int as visits,
           sum(o.total_gross - coalesce(o.total_service, 0))::bigint as spend
    from orders o join guests g on g.id = o.guest_id
    where o.status = 'paid' and ${scope(sql, r)}
    group by g.id order by spend desc limit 8`;
  return {
    guests: g!.guests,
    returning: g!.returning,
    newGuests: g!.new_guests,
    repeatRate: g!.guests ? g!.returning / g!.guests : null,
    top: top.map((t) => ({ id: t.id, name: t.name, visits: t.visits, spend: Number(t.spend) })),
  };
}

export interface HeatCell {
  dow: number; // 0 = Sunday
  hour: number;
  covers: number;
}

/** Covers arriving by weekday and hour: when the room actually fills. */
export async function busyHeatmap(sql: Sql, r: Range): Promise<HeatCell[]> {
  const rows = await sql`
    select extract(dow from o.opened_at at time zone ${r.timezone})::int as dow,
           extract(hour from o.opened_at at time zone ${r.timezone})::int as hour,
           sum(o.covers)::int as covers
    from orders o where o.status = 'paid' and ${scope(sql, r)}
    group by 1, 2`;
  return rows.map((x) => ({ dow: x.dow, hour: x.hour, covers: x.covers }));
}

export interface ReasonRow {
  kind: "comp" | "void";
  reason: string;
  count: number;
  value: number;
}

export async function compsAndVoids(sql: Sql, r: Range): Promise<ReasonRow[]> {
  const rows = await sql`
    select case when i.status = 'void' then 'void' else 'comp' end as kind,
           coalesce(case when i.status = 'void' then i.void_reason else i.comp_reason end, 'No reason') as reason,
           count(*)::int as n, sum((i.unit_price + i.modifiers_total) * i.quantity)::bigint as value
    from order_items i join orders o on o.id = i.order_id
    where (i.comped or i.status = 'void') and ${scope(sql, r)}
    group by 1, 2 order by value desc`;
  return rows.map((x) => ({ kind: x.kind, reason: x.reason, count: x.n, value: Number(x.value) }));
}

export interface LiveNow {
  openChecks: number;
  openValue: number;
  coversIn: number;
  coversStillDue: number;
  ticketsCooking: number;
  ticketsLate: number;
}

/** What's happening right now across the chosen sites. */
export async function liveNow(sql: Sql, companyId: string, siteIds: string[], timezone: string, now = new Date()): Promise<LiveNow> {
  const sites = siteIds.length ? sql`in ${sql(siteIds)}` : sql`in (select id from venues where company_id = ${companyId})`;
  const [o] = await sql`
    select count(*)::int as checks, coalesce(sum(o.covers), 0)::int as covers,
           coalesce(sum((select coalesce(sum((i.unit_price + i.modifiers_total) * i.quantity), 0) from order_items i
                         where i.order_id = o.id and i.status <> 'void' and not i.comped)), 0)::bigint as value
    from orders o where o.status = 'open' and o.venue_id ${sites}`;
  const [b] = await sql`
    select coalesce(sum(b.covers), 0)::int as due from bookings b
    where b.venue_id ${sites} and b.status in ('pending', 'confirmed') and b.starts_at >= ${now}
      and b.starts_at < ((${now}::timestamptz at time zone ${timezone})::date + 1)::timestamp at time zone ${timezone}`;
  const [t] = await sql`
    select count(*)::int as cooking,
           count(*) filter (where ${now}::timestamptz > t.fired_at + make_interval(mins => mx.prep))::int as late
    from tickets t join orders o on o.id = t.order_id
    join lateral (select max(prep_minutes) as prep from order_items i where i.ticket_id = t.id and i.status <> 'void') mx on true
    where t.bumped_at is null and o.status = 'open' and t.course > 0 and t.venue_id ${sites}`;
  return {
    openChecks: o!.checks,
    openValue: Number(o!.value),
    coversIn: o!.covers,
    coversStillDue: b!.due,
    ticketsCooking: t!.cooking,
    ticketsLate: t!.late,
  };
}
