// Station screens (kitchen, bar) and the pass. Raw tickets go to the browser,
// which runs the sequencing engine every few seconds against its own clock.

import type { Sql, TransactionSql } from "postgres";
import type { KitchenTicket } from "../kitchen/sequencing";
import type { Site } from "./booking";

type Db = Sql | TransactionSql;

export class KitchenError extends Error {}

export interface StationTicket extends KitchenTicket {
  orderId: string;
  /** Held items for the same table at this station: what's coming next. */
  upcoming: { name: string; quantity: number; course: number }[];
  allergyNote: string | null;
}

export interface StationInfo {
  code: string;
  name: string;
  kind: "kitchen" | "bar" | "pass";
}

const RECALL_WINDOW_MINUTES = 10;

function itemDetail(mods: { option: string }[], notes: string | null): string | undefined {
  const parts = [...mods.map((m) => m.option), ...(notes ? [notes] : [])];
  return parts.length ? parts.join(" · ") : undefined;
}

async function loadTickets(sql: Db, site: Site, where: { station?: string; readyForPass?: boolean }, now: Date) {
  const recallAfter = new Date(now.getTime() - RECALL_WINDOW_MINUTES * 60_000);
  const tickets = where.readyForPass
    ? await sql`
        select t.*, o.table_label, o.covers, b.special_requests
        from tickets t join orders o on o.id = t.order_id left join bookings b on b.id = o.booking_id
        join stations s on s.venue_id = t.venue_id and s.code = t.station and s.kind = 'kitchen'
        where t.venue_id = ${site.id} and o.status = 'open'
          and exists (select 1 from order_items i where i.ticket_id = t.id and i.status in ('sent', 'started', 'ready'))
        order by t.fired_at`
    : await sql`
        select t.*, o.table_label, o.covers, b.special_requests
        from tickets t join orders o on o.id = t.order_id left join bookings b on b.id = o.booking_id
        where t.venue_id = ${site.id} and t.station = ${where.station!}
          and (t.bumped_at is null or t.bumped_at > ${recallAfter})
        order by t.fired_at`;
  if (tickets.length === 0) return [];
  const ids = tickets.map((t) => t.id);
  const orderIds = [...new Set(tickets.map((t) => t.order_id))];
  const [items, held] = await Promise.all([
    sql`select * from order_items where ticket_id in ${sql(ids)} order by created_at`,
    sql`select order_id, name, quantity, course, station from order_items
        where order_id in ${sql(orderIds)} and status = 'held' order by course, created_at`,
  ]);
  return tickets.map(
    (t): StationTicket => ({
      id: t.id,
      number: Number(t.number),
      orderId: t.order_id,
      station: t.station,
      course: t.course,
      firedAt: t.fired_at,
      bumpedAt: t.bumped_at,
      priority: t.priority,
      tableLabel: t.table_label ?? "?",
      covers: t.covers,
      allergyNote: t.special_requests,
      items: items
        .filter((i) => i.ticket_id === t.id)
        .map((i) => ({
          id: i.id,
          name: i.name,
          quantity: i.quantity,
          prepMinutes: i.prep_minutes,
          status: i.status,
          startedAt: i.started_at,
          readyAt: i.ready_at,
          seat: i.seat,
          detail: itemDetail(i.modifiers, i.notes),
        })),
      upcoming: held
        .filter((h) => h.order_id === t.order_id && (where.readyForPass || h.station === t.station))
        .map((h) => ({ name: h.name, quantity: h.quantity, course: h.course })),
    }),
  );
}

export async function siteStationList(sql: Db, site: Site): Promise<StationInfo[]> {
  return sql<StationInfo[]>`select code, name, kind::text as kind from stations where venue_id = ${site.id} order by sort_order, name`;
}

export async function stationQueue(sql: Db, site: Site, station: string, now = new Date()) {
  const [s] = await sql<StationInfo[]>`select code, name, kind::text as kind from stations where venue_id = ${site.id} and code = ${station}`;
  if (!s) throw new KitchenError("Unknown station");
  if (s.kind === "pass") return { station: s, tickets: await loadTickets(sql, site, { readyForPass: true }, now) };
  return { station: s, tickets: await loadTickets(sql, site, { station }, now) };
}

async function hasPass(tx: TransactionSql, venueId: string) {
  const [p] = await tx`select 1 from stations where venue_id = ${venueId} and kind = 'pass'`;
  return !!p;
}

/** Bar tickets and kitchens without a pass are served as soon as they're ready. */
async function servesOnReady(tx: TransactionSql, venueId: string, station: string) {
  const [s] = await tx`select kind::text as kind from stations where venue_id = ${venueId} and code = ${station}`;
  return s?.kind === "bar" || !(await hasPass(tx, venueId));
}

async function lockTicket(tx: TransactionSql, site: Site, ticketId: string) {
  const [t] = await tx`select t.*, o.status as order_status from tickets t join orders o on o.id = t.order_id
                       where t.id = ${ticketId} and t.venue_id = ${site.id} for update of t`;
  if (!t) throw new KitchenError("Ticket not found");
  return t;
}

export async function startItems(sql: Sql, site: Site, ticketId: string, itemIds: string[] | "all", now = new Date()) {
  await sql.begin(async (tx) => {
    await lockTicket(tx, site, ticketId);
    await tx`update order_items set status = 'started', started_at = ${now}
             where ticket_id = ${ticketId} and status = 'sent'
               and (${itemIds === "all"} or id = any(${itemIds === "all" ? [] : itemIds}::uuid[]))`;
  });
}

/** Mark items ready. When the whole ticket is ready it bumps itself. */
export async function readyItems(sql: Sql, site: Site, ticketId: string, itemIds: string[] | "all", now = new Date()) {
  await sql.begin(async (tx) => {
    const t = await lockTicket(tx, site, ticketId);
    const serve = await servesOnReady(tx, site.id, t.station);
    await tx`update order_items set status = ${serve ? "served" : "ready"},
               started_at = coalesce(started_at, ${now}), ready_at = ${now},
               served_at = ${serve ? now : null}
             where ticket_id = ${ticketId} and status in ('sent', 'started')
               and (${itemIds === "all"} or id = any(${itemIds === "all" ? [] : itemIds}::uuid[]))`;
    const [{ left }] = (await tx`select count(*)::int as left from order_items
                                 where ticket_id = ${ticketId} and status in ('sent', 'started')`) as unknown as [{ left: number }];
    if (left === 0) await tx`update tickets set bumped_at = coalesce(bumped_at, ${now}) where id = ${ticketId}`;
  });
}

/** Undo a bump: items go back to cooking so the ticket reappears. */
export async function recallTicket(sql: Sql, site: Site, ticketId: string) {
  await sql.begin(async (tx) => {
    const t = await lockTicket(tx, site, ticketId);
    if (t.order_status !== "open") throw new KitchenError("That check is closed");
    await tx`update tickets set bumped_at = null where id = ${ticketId}`;
    await tx`update order_items set status = 'started', ready_at = null, served_at = null
             where ticket_id = ${ticketId} and status in ('ready', 'served')`;
  });
}

export async function setRush(sql: Sql, site: Site, ticketId: string, rush: boolean) {
  const r = await sql`update tickets set priority = ${rush} where id = ${ticketId} and venue_id = ${site.id} returning id`;
  if (!r.length) throw new KitchenError("Ticket not found");
}

/** The pass (or a server) takes food to the table. */
export async function serveItems(sql: Sql, site: Site, ticketId: string, itemIds: string[] | "all", now = new Date()) {
  await sql.begin(async (tx) => {
    await lockTicket(tx, site, ticketId);
    await tx`update order_items set status = 'served', served_at = ${now}
             where ticket_id = ${ticketId} and status = 'ready'
               and (${itemIds === "all"} or id = any(${itemIds === "all" ? [] : itemIds}::uuid[]))`;
  });
}

/** Serve every ready item on a check (from the POS: "food's on the table"). */
export async function serveOrder(sql: Sql, site: Site, orderId: string, now = new Date()) {
  await sql`update order_items set status = 'served', served_at = ${now}
            where order_id = ${orderId} and venue_id = ${site.id} and status = 'ready'`;
}
