// POS: checks, items, sending to stations, courses, payments.
// Every write runs in a transaction that locks the order row, so two tills
// working the same table can't interleave.

import type { Sql, TransactionSql } from "postgres";
import { computeBill, type BillTotals } from "../pos/totals";
import { summariseCourses, type CourseSummary } from "../kitchen/sequencing";
import { getSite, type Site } from "./booking";
import { consumeStock, loadMenu, type MenuItem } from "./menu";

type Db = Sql | TransactionSql;

export class OrderError extends Error {
  constructor(
    public code: "not_found" | "closed" | "invalid" | "unavailable" | "pin",
    message: string,
  ) {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------

export interface StaffMember {
  id: string;
  name: string;
  role: string;
}

export async function listStaff(sql: Db, companyId: string): Promise<StaffMember[]> {
  return sql<StaffMember[]>`
    select id, name, role::text as role from staff_members
    where company_id = ${companyId} and active and pin_hash is not null order by name`;
}

export async function verifyPin(sql: Db, companyId: string, staffId: string, pin: string): Promise<StaffMember> {
  if (!/^\d{4,6}$/.test(pin)) throw new OrderError("pin", "Wrong PIN");
  const [s] = await sql<StaffMember[]>`
    select id, name, role::text as role from staff_members
    where id = ${staffId} and company_id = ${companyId} and check_staff_pin(id, ${pin})`;
  if (!s) throw new OrderError("pin", "Wrong PIN");
  return s;
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export interface OrderItemView {
  id: string;
  menuItemId: string | null;
  name: string;
  unitPrice: number;
  modifiers: { group: string; option: string; priceDelta: number }[];
  modifiersTotal: number;
  quantity: number;
  vatRate: number;
  course: number;
  station: string;
  prepMinutes: number;
  seat: number | null;
  notes: string | null;
  status: "held" | "sent" | "started" | "ready" | "served" | "void";
  comped: boolean;
  compReason: string | null;
  voidReason: string | null;
  addedBy: string | null;
  createdAt: Date;
  sentAt: Date | null;
  startedAt: Date | null;
  readyAt: Date | null;
  servedAt: Date | null;
}

export interface PaymentView {
  id: string;
  method: string;
  amount: number;
  tip: number;
  takenBy: string | null;
  createdAt: Date;
}

export interface OrderView {
  id: string;
  number: number;
  venueId: string;
  tableId: string | null;
  tableLabel: string | null;
  bookingId: string | null;
  guestId: string | null;
  guestName: string | null;
  guestNotes: { visits: number; noShows: number; tags: string[]; allergies: string | null } | null;
  covers: number;
  status: "open" | "paid" | "void";
  openedBy: string | null;
  openedAt: Date;
  closedAt: Date | null;
  discount: { kind: "percent" | "amount"; value: number; reason: string | null } | null;
  serviceChargePct: number;
  items: OrderItemView[];
  payments: PaymentView[];
  totals: BillTotals;
  courses: CourseSummary[];
}

export async function getOrder(sql: Db, orderId: string): Promise<OrderView> {
  const [o] = await sql`
    select o.*, s.name as opened_by_name,
           nullif(trim(concat_ws(' ', g.first_name, g.last_name)), '') as guest_name,
           g.tags as guest_tags, gs.visits, gs.no_shows, b.special_requests
    from orders o
    left join staff_members s on s.id = o.opened_by
    left join guests g on g.id = o.guest_id
    left join guest_stats gs on gs.guest_id = o.guest_id
    left join bookings b on b.id = o.booking_id
    where o.id = ${orderId}`;
  if (!o) throw new OrderError("not_found", "Check not found");
  const [items, payments] = await Promise.all([
    sql`select i.*, s.name as added_by_name from order_items i
        left join staff_members s on s.id = i.added_by
        where i.order_id = ${orderId} order by i.course, i.created_at`,
    sql`select p.*, s.name as taken_by_name from order_payments p
        left join staff_members s on s.id = p.taken_by
        where p.order_id = ${orderId} order by p.created_at`,
  ]);
  const itemViews: OrderItemView[] = items.map((i) => ({
    id: i.id,
    menuItemId: i.menu_item_id,
    name: i.name,
    unitPrice: i.unit_price,
    modifiers: i.modifiers,
    modifiersTotal: i.modifiers_total,
    quantity: i.quantity,
    vatRate: Number(i.vat_rate),
    course: i.course,
    station: i.station,
    prepMinutes: i.prep_minutes,
    seat: i.seat,
    notes: i.notes,
    status: i.status,
    comped: i.comped,
    compReason: i.comp_reason,
    voidReason: i.void_reason,
    addedBy: i.added_by_name,
    createdAt: i.created_at,
    sentAt: i.sent_at,
    startedAt: i.started_at,
    readyAt: i.ready_at,
    servedAt: i.served_at,
  }));
  const paymentViews: PaymentView[] = payments.map((p) => ({
    id: p.id,
    method: p.method,
    amount: p.amount,
    tip: p.tip,
    takenBy: p.taken_by_name,
    createdAt: p.created_at,
  }));
  const discount = o.discount_kind ? { kind: o.discount_kind, value: o.discount_value, reason: o.discount_reason } : null;
  const serviceChargePct = Number(o.service_charge_pct);
  return {
    id: o.id,
    number: Number(o.number),
    venueId: o.venue_id,
    tableId: o.table_id,
    tableLabel: o.table_label,
    bookingId: o.booking_id,
    guestId: o.guest_id,
    guestName: o.guest_name,
    guestNotes: o.guest_id
      ? { visits: o.visits ?? 0, noShows: o.no_shows ?? 0, tags: o.guest_tags ?? [], allergies: o.special_requests }
      : null,
    covers: o.covers,
    status: o.status,
    openedBy: o.opened_by_name,
    openedAt: o.opened_at,
    closedAt: o.closed_at,
    discount,
    serviceChargePct,
    items: itemViews,
    payments: paymentViews,
    totals: computeBill({
      lines: itemViews.map((i) => ({
        unitPrice: i.unitPrice,
        modifiersTotal: i.modifiersTotal,
        quantity: i.quantity,
        vatRate: i.vatRate,
        comped: i.comped,
        voided: i.status === "void",
        seat: i.seat,
      })),
      discount,
      serviceChargePct,
      payments: paymentViews,
    }),
    courses: summariseCourses(itemViews),
  };
}

export interface FloorTable {
  id: string;
  label: string;
  areaName: string;
  maxCovers: number;
  posX: number | null;
  posY: number | null;
  order: {
    id: string;
    number: number;
    covers: number;
    openedAt: Date;
    total: number;
    itemCount: number;
    heldCourses: number[];
    readyToRun: number;
    guestName: string | null;
  } | null;
  /** Booking on this table now or within the next 45 minutes. */
  booking: { id: string; guestName: string; covers: number; start: Date; status: string } | null;
}

/** Every table with its open check (if any) and its current or next booking. */
export async function siteFloor(sql: Db, site: Site, now = new Date()): Promise<{ tables: FloorTable[]; other: FloorTable["order"][] }> {
  const [tables, orders, bookings] = await Promise.all([
    sql`select t.id, t.label, a.name as area_name, t.max_covers, t.pos_x, t.pos_y
        from tables t join areas a on a.id = t.area_id
        where t.venue_id = ${site.id} and t.active order by a.sort_order, a.name, length(t.label), t.label`,
    sql`select o.id, o.number, o.table_id, o.covers, o.opened_at,
               nullif(trim(concat_ws(' ', g.first_name, g.last_name)), '') as guest_name,
               coalesce(sum((i.unit_price + i.modifiers_total) * i.quantity)
                        filter (where i.status <> 'void' and not i.comped), 0)::int as total,
               count(i.id) filter (where i.status <> 'void')::int as item_count,
               coalesce(array_agg(distinct i.course) filter (where i.status = 'held'), '{}') as held_courses,
               count(i.id) filter (where i.status = 'ready')::int as ready_to_run
        from orders o
        left join order_items i on i.order_id = o.id
        left join guests g on g.id = o.guest_id
        where o.venue_id = ${site.id} and o.status = 'open'
        group by o.id, g.id`,
    sql`select b.id, b.covers, b.starts_at, b.status::text as status, bt.table_id,
               coalesce(nullif(trim(concat_ws(' ', g.first_name, g.last_name)), ''), 'Walk-in') as guest_name
        from bookings b
        join booking_tables bt on bt.booking_id = b.id
        left join guests g on g.id = b.guest_id
        where b.venue_id = ${site.id}
          and b.status in ('pending', 'confirmed', 'seated')
          and upper(b.blocked_during) > ${now}
          and b.starts_at < ${new Date(now.getTime() + 45 * 60_000)}
        order by b.starts_at`,
  ]);
  const toOrder = (o: (typeof orders)[number]) => ({
    id: o.id,
    number: Number(o.number),
    covers: o.covers,
    openedAt: o.opened_at,
    total: o.total,
    itemCount: o.item_count,
    heldCourses: (o.held_courses as number[]).sort((a, b) => a - b),
    readyToRun: o.ready_to_run,
    guestName: o.guest_name,
  });
  return {
    tables: tables.map((t) => {
      const o = orders.find((x) => x.table_id === t.id);
      const b = bookings.find((x) => x.table_id === t.id);
      return {
        id: t.id,
        label: t.label,
        areaName: t.area_name,
        maxCovers: t.max_covers,
        posX: t.pos_x,
        posY: t.pos_y,
        order: o ? toOrder(o) : null,
        booking: b ? { id: b.id, guestName: b.guest_name, covers: b.covers, start: b.starts_at, status: b.status } : null,
      };
    }),
    other: orders.filter((o) => !o.table_id).map(toOrder),
  };
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

async function lockOpenOrder(tx: TransactionSql, orderId: string, venueId: string) {
  const [o] = await tx`select * from orders where id = ${orderId} and venue_id = ${venueId} for update`;
  if (!o) throw new OrderError("not_found", "Check not found");
  if (o.status !== "open") throw new OrderError("closed", "This check is closed");
  return o;
}

export async function openOrder(
  sql: Sql,
  site: Site,
  input: { tableId?: string | null; label?: string; covers: number; bookingId?: string | null; staffId?: string | null },
  now = new Date(),
): Promise<string> {
  if (!Number.isInteger(input.covers) || input.covers < 1 || input.covers > 100) {
    throw new OrderError("invalid", "Covers must be between 1 and 100");
  }
  return sql.begin(async (tx) => {
    let label = input.label?.trim() || null;
    if (input.tableId) {
      const [t] = await tx`select label from tables where id = ${input.tableId} and venue_id = ${site.id}`;
      if (!t) throw new OrderError("not_found", "Table not found");
      label = t.label;
      // Lock the table's open-check slot; return the existing check if there is one.
      await tx`select pg_advisory_xact_lock(hashtextextended(${`table:${input.tableId}`}, 0))`;
      const [existing] = await tx`select id from orders where table_id = ${input.tableId} and status = 'open'`;
      if (existing) return existing.id as string;
    }
    if (!label) throw new OrderError("invalid", "Give the check a table or a name");

    // Link the booking on this table now (or the one asked for), and seat it.
    let bookingId = input.bookingId ?? null;
    if (!bookingId && input.tableId) {
      const [b] = await tx`
        select b.id from bookings b join booking_tables bt on bt.booking_id = b.id
        where bt.table_id = ${input.tableId} and b.status in ('pending', 'confirmed', 'seated')
          and b.starts_at <= ${new Date(now.getTime() + 45 * 60_000)} and upper(b.blocked_during) > ${now}
        order by (b.status = 'seated') desc, b.starts_at limit 1`;
      bookingId = b?.id ?? null;
    }
    let guestId: string | null = null;
    if (bookingId) {
      const [b] = await tx`select guest_id, status from bookings where id = ${bookingId} and venue_id = ${site.id}`;
      if (!b) throw new OrderError("not_found", "Booking not found");
      guestId = b.guest_id;
      if (b.status === "pending" || b.status === "confirmed") {
        await tx`update bookings set status = 'seated' where id = ${bookingId}`;
      }
    }
    const [svc] = await tx`select service_charge_pct from venues where id = ${site.id}`;
    const [o] = await tx`
      insert into orders (venue_id, table_id, table_label, booking_id, guest_id, covers, opened_by, service_charge_pct, opened_at)
      values (${site.id}, ${input.tableId ?? null}, ${label}, ${bookingId}, ${guestId}, ${input.covers},
              ${input.staffId ?? null}, ${svc!.service_charge_pct}, ${now})
      returning id`;
    return o!.id as string;
  });
}

export interface AddItemInput {
  menuItemId: string;
  quantity?: number;
  /** Chosen modifier option ids. */
  optionIds?: string[];
  seat?: number | null;
  course?: number | null;
  notes?: string | null;
  staffId?: string | null;
}

/** Validate modifier choices against the item's groups; returns the snapshot. */
export function resolveModifiers(item: MenuItem, optionIds: string[]) {
  const chosen = new Set(optionIds);
  const known = new Set(item.modifierGroups.flatMap((g) => g.options.map((o) => o.id)));
  for (const id of chosen) if (!known.has(id)) throw new OrderError("invalid", "That option isn't available for this item");
  const snapshot: { group: string; option: string; priceDelta: number }[] = [];
  for (const g of item.modifierGroups) {
    const picks = g.options.filter((o) => chosen.has(o.id));
    if (picks.length < g.minSelect) throw new OrderError("invalid", `Choose ${g.name.toLowerCase()}`);
    if (picks.length > g.maxSelect) throw new OrderError("invalid", `Up to ${g.maxSelect} for ${g.name.toLowerCase()}`);
    for (const p of picks) snapshot.push({ group: g.name, option: p.name, priceDelta: p.priceDelta });
  }
  return { modifiers: snapshot, modifiersTotal: snapshot.reduce((n, m) => n + m.priceDelta, 0) };
}

export async function addItem(sql: Sql, site: Site, orderId: string, input: AddItemInput): Promise<string> {
  const qty = input.quantity ?? 1;
  if (!Number.isInteger(qty) || qty < 1 || qty > 99) throw new OrderError("invalid", "Quantity must be 1-99");
  if (input.seat != null && (!Number.isInteger(input.seat) || input.seat < 1 || input.seat > 100)) {
    throw new OrderError("invalid", "Seat must be a positive number");
  }
  return sql.begin(async (tx) => {
    await lockOpenOrder(tx, orderId, site.id);
    const menu = await loadMenu(tx, site);
    const item = menu.flatMap((c) => c.items).find((i) => i.id === input.menuItemId);
    if (!item) throw new OrderError("not_found", "Item not on the menu");
    if (!item.available) throw new OrderError("unavailable", `${item.name} is off (86)`);
    if (item.stockRemaining !== null) {
      const [{ pending }] = (await tx`
        select coalesce(sum(quantity), 0)::int as pending from order_items i join orders o on o.id = i.order_id
        where o.venue_id = ${site.id} and o.status = 'open' and i.menu_item_id = ${item.id} and i.status = 'held'`) as unknown as [{ pending: number }];
      if (pending + qty > item.stockRemaining) {
        throw new OrderError("unavailable", `Only ${Math.max(0, item.stockRemaining - pending)} ${item.name} left`);
      }
    }
    const { modifiers, modifiersTotal } = resolveModifiers(item, input.optionIds ?? []);
    const course = input.course ?? item.course;
    if (!Number.isInteger(course) || course < 0 || course > 9) throw new OrderError("invalid", "Course must be 0-9");
    const [row] = await tx`
      insert into order_items ${tx({
        order_id: orderId,
        venue_id: site.id,
        menu_item_id: item.id,
        name: item.name,
        unit_price: item.price,
        modifiers: tx.json(modifiers),
        modifiers_total: modifiersTotal,
        quantity: qty,
        cost: item.cost,
        vat_rate: item.vatRate,
        course,
        station: item.station,
        prep_minutes: item.prepMinutes,
        seat: input.seat ?? null,
        notes: input.notes?.trim() || null,
        added_by: input.staffId ?? null,
      })}
      returning id`;
    return row!.id as string;
  });
}

/** Change an item that hasn't gone to the kitchen yet. */
export async function updateHeldItem(
  sql: Sql,
  site: Site,
  itemId: string,
  patch: { quantity?: number; seat?: number | null; course?: number; notes?: string | null },
) {
  await sql.begin(async (tx) => {
    const [i] = await tx`select order_id, status from order_items where id = ${itemId} and venue_id = ${site.id}`;
    if (!i) throw new OrderError("not_found", "Item not found");
    await lockOpenOrder(tx, i.order_id, site.id);
    if (i.status !== "held") throw new OrderError("invalid", "Already sent: void it instead");
    const set: Record<string, unknown> = {};
    if (patch.quantity !== undefined) {
      if (!Number.isInteger(patch.quantity) || patch.quantity < 1 || patch.quantity > 99) throw new OrderError("invalid", "Quantity must be 1-99");
      set.quantity = patch.quantity;
    }
    if (patch.seat !== undefined) set.seat = patch.seat;
    if (patch.course !== undefined) set.course = patch.course;
    if (patch.notes !== undefined) set.notes = patch.notes?.trim() || null;
    if (Object.keys(set).length) await tx`update order_items set ${tx(set)} where id = ${itemId}`;
  });
}

/** Remove an unsent item outright, or void a sent one (needs a reason, stays on record). */
export async function removeItem(sql: Sql, site: Site, itemId: string, reason?: string) {
  await sql.begin(async (tx) => {
    const [i] = await tx`select order_id, status from order_items where id = ${itemId} and venue_id = ${site.id}`;
    if (!i) throw new OrderError("not_found", "Item not found");
    await lockOpenOrder(tx, i.order_id, site.id);
    if (i.status === "held") {
      await tx`delete from order_items where id = ${itemId}`;
      return;
    }
    if (i.status === "void") return;
    if (!reason?.trim()) throw new OrderError("invalid", "Give a reason to void an item that's been sent");
    await tx`update order_items set status = 'void', void_reason = ${reason.trim()}, voided_at = now() where id = ${itemId}`;
  });
}

export async function compItem(sql: Sql, site: Site, itemId: string, reason: string | null) {
  await sql.begin(async (tx) => {
    const [i] = await tx`select order_id from order_items where id = ${itemId} and venue_id = ${site.id}`;
    if (!i) throw new OrderError("not_found", "Item not found");
    await lockOpenOrder(tx, i.order_id, site.id);
    if (reason !== null && !reason.trim()) throw new OrderError("invalid", "Give a reason for the comp");
    await tx`update order_items set comped = ${reason !== null}, comp_reason = ${reason?.trim() ?? null} where id = ${itemId}`;
  });
}

/** Map item station codes to the site's stations; unknown codes go to the first kitchen. */
async function stationResolver(tx: TransactionSql, venueId: string) {
  const stations = await tx`select code, kind::text as kind from stations where venue_id = ${venueId} order by sort_order, name`;
  const codes = new Set(stations.map((s) => s.code as string));
  const fallbackKitchen = stations.find((s) => s.kind === "kitchen")?.code ?? "kitchen";
  const fallbackBar = stations.find((s) => s.kind === "bar")?.code ?? fallbackKitchen;
  return (code: string, course: number) => (codes.has(code) ? code : course === 0 ? fallbackBar : fallbackKitchen);
}

/**
 * Send held items to their stations. `courses` picks which courses go now:
 * "upTo" sends drinks plus every course up to N; "only" fires exactly those.
 * One ticket per station and course. Returns the number of items sent.
 */
export async function sendItems(
  sql: Sql,
  site: Site,
  orderId: string,
  courses: { upTo: number } | { only: number[] },
  now = new Date(),
): Promise<number> {
  return sql.begin(async (tx) => {
    await lockOpenOrder(tx, orderId, site.id);
    const held = await tx`select id, course, station, menu_item_id, quantity from order_items
                          where order_id = ${orderId} and status = 'held' order by created_at`;
    const go = held.filter((i) =>
      "upTo" in courses ? i.course === 0 || i.course <= courses.upTo : courses.only.includes(i.course),
    );
    if (go.length === 0) return 0;
    const resolve = await stationResolver(tx, site.id);
    const groups = new Map<string, typeof go>();
    for (const i of go) {
      const key = `${resolve(i.station, i.course)}\u0000${i.course}`;
      groups.set(key, [...(groups.get(key) ?? []), i]);
    }
    for (const [key, list] of groups) {
      const [station, course] = key.split("\u0000");
      const [t] = await tx`insert into tickets (venue_id, order_id, station, course, fired_at)
                           values (${site.id}, ${orderId}, ${station!}, ${Number(course)}, ${now}) returning id`;
      await tx`update order_items set status = 'sent', sent_at = ${now}, ticket_id = ${t!.id}, station = ${station!}
               where id in ${tx(list.map((i) => i.id))}`;
    }
    const counts = new Map<string, number>();
    for (const i of go) if (i.menu_item_id) counts.set(i.menu_item_id, (counts.get(i.menu_item_id) ?? 0) + i.quantity);
    await consumeStock(tx, site.id, counts);
    return go.length;
  });
}

export async function setDiscount(
  sql: Sql,
  site: Site,
  orderId: string,
  discount: { kind: "percent" | "amount"; value: number; reason: string } | null,
) {
  if (discount) {
    if (!Number.isInteger(discount.value) || discount.value <= 0) throw new OrderError("invalid", "Discount must be positive");
    if (discount.kind === "percent" && discount.value > 100) throw new OrderError("invalid", "Discount can't exceed 100%");
    if (!discount.reason.trim()) throw new OrderError("invalid", "Give a reason for the discount");
  }
  await sql.begin(async (tx) => {
    await lockOpenOrder(tx, orderId, site.id);
    await tx`update orders set discount_kind = ${discount?.kind ?? null}, discount_value = ${discount?.value ?? 0},
             discount_reason = ${discount?.reason.trim() ?? null} where id = ${orderId}`;
  });
}

export async function setServiceCharge(sql: Sql, site: Site, orderId: string, pct: number) {
  if (!(pct >= 0 && pct <= 25)) throw new OrderError("invalid", "Service charge must be 0-25%");
  await sql.begin(async (tx) => {
    await lockOpenOrder(tx, orderId, site.id);
    await tx`update orders set service_charge_pct = ${pct} where id = ${orderId}`;
  });
}

export async function setCovers(sql: Sql, site: Site, orderId: string, covers: number) {
  if (!Number.isInteger(covers) || covers < 1 || covers > 100) throw new OrderError("invalid", "Covers must be 1-100");
  await sql.begin(async (tx) => {
    await lockOpenOrder(tx, orderId, site.id);
    await tx`update orders set covers = ${covers} where id = ${orderId}`;
  });
}

/**
 * Take a payment. When the bill is covered the check closes: totals are
 * snapshotted for reporting and a linked booking is marked finished.
 * Returns the order's state after the payment.
 */
export async function takePayment(
  sql: Sql,
  site: Site,
  orderId: string,
  input: { method: "card" | "cash" | "voucher" | "other"; amount: number; tip?: number; staffId?: string | null; reference?: string },
  now = new Date(),
): Promise<{ closed: boolean; balance: number; change: number }> {
  if (!Number.isInteger(input.amount) || input.amount <= 0) throw new OrderError("invalid", "Amount must be positive");
  const tip = input.tip ?? 0;
  if (!Number.isInteger(tip) || tip < 0) throw new OrderError("invalid", "Tip can't be negative");
  return sql.begin(async (tx) => {
    await lockOpenOrder(tx, orderId, site.id);
    const before = await getOrder(tx, orderId);
    if (before.totals.balance <= 0 && before.totals.total > 0) throw new OrderError("invalid", "Already paid");
    // Card and voucher can't take more than is owed; cash can (change is given).
    if (input.method !== "cash" && input.amount > before.totals.balance) {
      throw new OrderError("invalid", "That's more than is owed. Put the extra on as a tip.");
    }
    await tx`insert into order_payments (order_id, venue_id, method, amount, tip, taken_by, reference, created_at)
             values (${orderId}, ${site.id}, ${input.method}, ${input.amount}, ${tip}, ${input.staffId ?? null},
                     ${input.reference ?? null}, ${now})`;
    const after = await getOrder(tx, orderId);
    const closed = after.totals.balance <= 0;
    if (closed) await closeOrder(tx, after, now);
    return { closed, balance: Math.max(0, after.totals.balance), change: Math.max(0, -after.totals.balance) };
  });
}

async function closeOrder(tx: TransactionSql, o: OrderView, now: Date) {
  await tx`update orders set status = 'paid', closed_at = ${now}, total_gross = ${o.totals.total},
           total_vat = ${o.totals.vatTotal}, total_service = ${o.totals.serviceCharge}, total_discount = ${o.totals.discount}
           where id = ${o.id}`;
  // Anything never sent is dropped from the kitchen's view; anything ready is served.
  await tx`update order_items set served_at = coalesce(served_at, ${now}), status = 'served'
           where order_id = ${o.id} and status = 'ready'`;
  if (o.bookingId) {
    await tx`update bookings set status = 'completed',
             duration_minutes = greatest(1, least(duration_minutes, ceil(extract(epoch from (${now}::timestamptz - starts_at)) / 60)::int))
             where id = ${o.bookingId} and status = 'seated'`;
  }
}

/** Close a check with nothing to pay (e.g. everything comped). */
export async function closeZeroCheck(sql: Sql, site: Site, orderId: string, now = new Date()) {
  await sql.begin(async (tx) => {
    await lockOpenOrder(tx, orderId, site.id);
    const o = await getOrder(tx, orderId);
    if (o.totals.balance > 0) throw new OrderError("invalid", "There's still money owing");
    await closeOrder(tx, o, now);
  });
}

export async function voidOrder(sql: Sql, site: Site, orderId: string, reason: string) {
  if (!reason.trim()) throw new OrderError("invalid", "Give a reason to void the check");
  await sql.begin(async (tx) => {
    await lockOpenOrder(tx, orderId, site.id);
    const [{ n }] = (await tx`select count(*)::int as n from order_payments where order_id = ${orderId}`) as unknown as [{ n: number }];
    if (n > 0) throw new OrderError("invalid", "Payments have been taken: refund them first");
    await tx`update order_items set status = 'void', void_reason = coalesce(void_reason, ${reason.trim()}),
             voided_at = coalesce(voided_at, now()) where order_id = ${orderId} and status <> 'void'`;
    await tx`update orders set status = 'void', void_reason = ${reason.trim()}, closed_at = now() where id = ${orderId}`;
  });
}

/** Move a check to another (free) table. */
export async function moveOrder(sql: Sql, site: Site, orderId: string, tableId: string) {
  await sql.begin(async (tx) => {
    await lockOpenOrder(tx, orderId, site.id);
    const [t] = await tx`select label from tables where id = ${tableId} and venue_id = ${site.id}`;
    if (!t) throw new OrderError("not_found", "Table not found");
    const [busy] = await tx`select 1 from orders where table_id = ${tableId} and status = 'open' and id <> ${orderId}`;
    if (busy) throw new OrderError("invalid", `Table ${t.label} already has a check open`);
    await tx`update orders set table_id = ${tableId}, table_label = ${t.label} where id = ${orderId}`;
  });
}

export async function siteForSlug(sql: Db, slug: string) {
  return getSite(sql, slug);
}
