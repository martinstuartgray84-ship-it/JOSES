// Operations: today's forecast from the site's own history, and live load on
// the bar, kitchen and floor. The maths lives in src/ops/ops.ts.

import type { Sql } from "postgres";
import {
  DEFAULT_RATIOS,
  forecastCovers,
  opsAlerts,
  planStaffing,
  preBatch,
  prepList,
  serverLoads,
  stationLoad,
  type HourForecast,
  type OpsAlert,
  type PrepLine,
  type QueueItem,
  type ServerLoad,
  type StaffingHour,
  type StationNow,
} from "../ops/ops";
import { localParts, type Site } from "./booking";
import { KIND_SQL, liveFloor, type FloorView } from "./floor";

const HISTORY_DAYS = 56;
const DEFAULTS = { noShowRate: 0.05, dwellMinutes: 90, drinksPerCoverHour: 1, platesPerCover: 2 };

export interface DayForecast {
  date: string;
  /** The forecast made from bookings and history, with actual arrivals so far. */
  hours: (HourForecast & { actual: number | null })[];
  /** Per hour, from the blended view (actuals so far, forecast after). */
  staffing: StaffingHour[];
  prep: PrepLine[];
  batch: { name: string; expected: number }[];
  expectedCovers: number;
  bookedCovers: number;
  noShowRate: number;
  dwellMinutes: number;
  usage: { drinksPerCoverHour: number; platesPerCover: number };
  /** Same weekdays in the last 8 weeks that had trade (walk-in history). */
  weeksOfHistory: number;
}

/**
 * Covers, staff, prep and batching for one local date. Bookings come from the
 * diary; walk-ins, no-shows, dwell and what guests order come from the last
 * 8 weeks (walk-ins from the same weekday).
 */
export async function forecastDay(sql: Sql, site: Site, date: string, now = new Date()): Promise<DayForecast> {
  const tz = site.timezone;
  const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
  const [bookings, walkIns, services, [histRow], mix, actual] = await Promise.all([
    sql`
      select extract(hour from b.starts_at at time zone ${tz})::int as hour, sum(b.covers)::int as covers,
             b.status in ('seated', 'completed') as arrived
      from bookings b
      where b.venue_id = ${site.id} and (b.starts_at at time zone ${tz})::date = ${date}::date
        and b.status not in ('cancelled', 'no_show')
      group by 1, 3`,
    sql`
      with days as (select (${date}::date - n * 7) as d from generate_series(1, 8) n),
      o as (
        select (o.opened_at at time zone ${tz})::date as d, extract(hour from o.opened_at at time zone ${tz})::int as hour,
               o.covers, o.booking_id
        from orders o
        where o.venue_id = ${site.id} and o.status = 'paid'
          and (o.opened_at at time zone ${tz})::date in (select d from days)
      )
      select hour, sum(covers) filter (where booking_id is null)::int as covers, (select count(distinct d) from o)::int as weeks
      from o group by hour`,
    sql`
      select first_seating, last_seating from services
      where venue_id = ${site.id} and active and ${dow} = any(days_of_week)
        and (valid_from is null or valid_from <= ${date}::date) and (valid_to is null or valid_to >= ${date}::date)`,
    sql.unsafe(
      `with o as (
         select o.id, o.covers, extract(epoch from o.closed_at - o.opened_at) / 60 as dwell
         from orders o where o.venue_id = $1 and o.status = 'paid' and o.covers > 0 and o.closed_at > $2
       ), lines as (
         select i.quantity, i.course, ${KIND_SQL} as kind
         from o join order_items i on i.order_id = o.id
         left join menu_items mi on mi.id = i.menu_item_id left join menu_categories c on c.id = mi.category_id
         where i.status <> 'void'
       )
       select (select count(*) from o)::int as checks,
              (select sum(covers) from o)::float as covers,
              (select sum(covers * dwell / 60) from o)::float as cover_hours,
              (select percentile_cont(0.5) within group (order by dwell) from o) as dwell,
              (select sum(quantity) from lines where kind <> 'food')::float as drinks,
              (select sum(quantity) from lines where kind = 'food')::float as plates,
              (select avg(case when b.status = 'no_show' then 1.0 else 0 end) from bookings b
                where b.venue_id = $1 and b.status in ('completed', 'seated', 'no_show') and b.starts_at > $2 and b.starts_at < $3) as no_show`,
      [site.id, new Date(now.getTime() - HISTORY_DAYS * 86_400_000), now],
    ),
    sql.unsafe(
      `with o as (
         select o.id, o.covers from orders o
         where o.venue_id = $1 and o.status = 'paid' and o.covers > 0 and o.closed_at > $2
       ), lines as (
         select i.name, i.quantity, ${KIND_SQL} as kind, coalesce(c.name, '') ~* 'cocktail' as cocktail
         from o join order_items i on i.order_id = o.id
         left join menu_items mi on mi.id = i.menu_item_id left join menu_categories c on c.id = mi.category_id
         where i.status <> 'void'
       )
       select name, kind, bool_or(cocktail) as cocktail, sum(quantity)::float as qty,
              (select sum(covers) from o)::float as covers,
              (select sum(quantity) from lines where kind <> 'food')::float as drinks
       from lines group by name, kind`,
      [site.id, new Date(now.getTime() - HISTORY_DAYS * 86_400_000)],
    ),
    sql`
      select extract(hour from o.opened_at at time zone ${tz})::int as hour, sum(o.covers)::int as covers
      from orders o
      where o.venue_id = ${site.id} and o.status <> 'void' and (o.opened_at at time zone ${tz})::date = ${date}::date
      group by 1`,
  ]);

  const hist = histRow!;
  const enough = (hist.checks ?? 0) >= 20;
  const noShowRate = hist.no_show === null || hist.no_show === undefined ? DEFAULTS.noShowRate : Number(hist.no_show);
  const dwellMinutes = enough && hist.dwell !== null ? Math.round(Number(hist.dwell)) : DEFAULTS.dwellMinutes;
  const usage = enough
    ? {
        drinksPerCoverHour: round2((hist.drinks ?? 0) / Math.max(1, hist.cover_hours)),
        platesPerCover: round2((hist.plates ?? 0) / Math.max(1, hist.covers)),
      }
    : { drinksPerCoverHour: DEFAULTS.drinksPerCoverHour, platesPerCover: DEFAULTS.platesPerCover };

  const weeks = walkIns[0]?.weeks ?? 0;
  const walkInsByHour: Record<number, number> = {};
  for (const w of walkIns) if (weeks > 0) walkInsByHour[w.hour] = round1((w.covers ?? 0) / weeks);
  const openHours = new Set<number>();
  for (const s of services) for (let h = Math.floor(s.first_seating / 60); h <= Math.floor(s.last_seating / 60); h++) openHours.add(h % 24);
  for (const [h, n] of Object.entries(walkInsByHour)) if (n >= 0.5) openHours.add(Number(h));

  const forecast = forecastCovers({
    bookings: bookings.map((b) => ({ hour: b.hour, covers: b.covers, arrived: b.arrived })),
    walkInsByHour,
    noShowRate,
    dwellMinutes,
    openHours: [...openHours],
  });
  const actualBy = new Map(actual.map((a) => [a.hour as number, a.covers as number]));
  const { date: today, minutes } = localParts(now, tz);
  const pastHour = (h: number) => date < today || (date === today && h <= Math.floor(minutes / 60));
  const hours = forecast.map((f) => ({ ...f, actual: pastHour(f.hour) ? (actualBy.get(f.hour) ?? 0) : null }));

  // Re-forecast as the day unfolds: hours gone use who actually came, later
  // hours keep the forecast. Staffing and prep follow the blended view.
  const started = hours.some((h) => h.actual !== null);
  const blended = started
    ? forecastCovers({
        bookings: [
          ...hours.filter((h) => h.actual !== null).map((h) => ({ hour: h.hour, covers: h.actual!, arrived: true })),
          ...bookings.filter((b) => !pastHour(b.hour)).map((b) => ({ hour: b.hour, covers: b.covers, arrived: b.arrived })),
        ],
        walkInsByHour: Object.fromEntries(Object.entries(walkInsByHour).filter(([h]) => !pastHour(Number(h)))),
        noShowRate,
        dwellMinutes,
        openHours: [...openHours],
      })
    : forecast;
  const expectedCovers = Math.round(blended.reduce((n, f) => n + f.arrivals, 0));
  const totalCovers = mix[0]?.covers ?? 0;
  const totalDrinks = mix[0]?.drinks ?? 0;
  const prep = totalCovers
    ? prepList(
        expectedCovers,
        mix.filter((m) => m.kind === "food").map((m) => ({ name: m.name as string, perCover: m.qty / totalCovers })),
      ).slice(0, 15)
    : [];
  const peak = Math.max(0, ...blended.filter((f) => !pastHour(f.hour) || f.hour === Math.floor(minutes / 60)).map((f) => f.inHouse));
  const batch = totalDrinks
    ? preBatch(peak, usage.drinksPerCoverHour, mix.filter((m) => m.cocktail).map((m) => ({ name: m.name as string, share: m.qty / totalDrinks })))
    : [];

  return {
    date,
    hours,
    staffing: planStaffing(blended, usage),
    prep,
    batch,
    expectedCovers,
    bookedCovers: bookings.reduce((n, b) => n + b.covers, 0),
    noShowRate: round2(noShowRate),
    dwellMinutes,
    usage,
    weeksOfHistory: weeks,
  };
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

export interface LiveOps {
  stations: StationNow[];
  servers: ServerLoad[];
  alerts: OpsAlert[];
  arrivingSoon: number;
  /** The plan for this hour, used for hands per station. */
  plan: StaffingHour | null;
  floor: FloorView["totals"];
}

/** Live load on every station and server, and what to change. */
export async function liveOps(sql: Sql, site: Site, now = new Date(), floor?: FloorView, today?: DayForecast): Promise<LiveOps> {
  const local = localParts(now, site.timezone);
  const [fl, fc, stations, items, [soon]] = await Promise.all([
    floor ?? liveFloor(sql, site, now),
    today ?? forecastDay(sql, site, local.date, now),
    sql`select code, name, kind::text as kind from stations where venue_id = ${site.id} and kind <> 'pass' order by sort_order, name`,
    sql`
      select i.station, i.quantity, i.prep_minutes, i.status::text as status, i.sent_at, i.ready_at
      from order_items i join orders o on o.id = i.order_id
      where i.venue_id = ${site.id} and o.status = 'open' and i.status in ('sent', 'started', 'ready')`,
    sql`
      select coalesce(sum(covers), 0)::int as covers from bookings
      where venue_id = ${site.id} and status in ('pending', 'confirmed')
        and starts_at >= ${now} and starts_at < ${new Date(now.getTime() + 30 * 60_000)}`,
  ]);
  const plan = fc.staffing.find((s) => s.hour === Math.floor(local.minutes / 60)) ?? null;
  const kitchens = stations.filter((s) => s.kind === "kitchen").length || 1;
  const bars = stations.filter((s) => s.kind === "bar").length || 1;

  const stationViews: StationNow[] = stations.map((st) => {
    const mine = items.filter((i) => i.station === st.code);
    const queue: QueueItem[] = mine
      .filter((i) => i.status !== "ready")
      .map((i) => ({ quantity: i.quantity, prepMinutes: i.prep_minutes, status: i.status, sentAt: i.sent_at ?? now }));
    const planned = st.kind === "bar" ? (plan?.bar ?? DEFAULT_RATIOS.minimum.bar) / bars : (plan?.kitchen ?? DEFAULT_RATIOS.minimum.kitchen) / kitchens;
    const ready = mine.filter((i) => i.status === "ready");
    const oldestReady = ready.length ? Math.max(...ready.map((i) => (now.getTime() - new Date(i.ready_at ?? now).getTime()) / 60_000)) : 0;
    return {
      code: st.code,
      name: st.name,
      kind: st.kind,
      ...stationLoad(queue, Math.max(1, planned), now),
      readyWaiting: ready.reduce((n, i) => n + i.quantity, 0),
      oldestReadyMinutes: Math.round(oldestReady),
    };
  });
  const servers = serverLoads(
    fl.tables.map((t) => ({ server: t.server, covers: t.covers, urgent: t.result.nudges.filter((n) => n.priority === 1).length })),
  );
  const mainsDue = fl.tables.filter((t) => t.result.nudges.some((n) => n.kind === "fire_mains")).length;
  return {
    stations: stationViews,
    servers,
    alerts: opsAlerts({ stations: stationViews, servers, arrivingSoon: soon!.covers, mainsDue }),
    arrivingSoon: soon!.covers,
    plan,
    floor: fl.totals,
  };
}
