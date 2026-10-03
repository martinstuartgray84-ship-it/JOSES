// Integration tests for menu, POS and kitchen services. Run via `npm run test:db`.
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { parseMenuImport } from "../menu/import";
import { getSite } from "./booking";
import { applyImport, loadMenu, setEightySixed, setSitePrice, setStock } from "./menu";
import {
  addItem,
  compItem,
  getOrder,
  listStaff,
  moveOrder,
  openOrder,
  removeItem,
  sendItems,
  setDiscount,
  siteFloor,
  takePayment,
  updateHeldItem,
  verifyPin,
  voidOrder,
} from "./orders";
import { readyItems, recallTicket, serveItems, startItems, stationQueue } from "./kitchen";

const url = process.env.DATABASE_URL;

const MENU = [
  "category,name,price,course,station,prep,allergens,cost,modifiers",
  "Drinks,House red,7.50,drinks,bar,1,sulphites,2.10,",
  "Drinks,Negroni,10,drinks,bar,3,,2.40,",
  "Starters,Soup,7,starters,,6,celery,1.20,",
  "Starters,Burrata,9.5,starters,,4,milk,3.10,",
  'Mains,Ribeye,28,mains,,14,milk,9.80,"Temperature*: Rare | Medium | Well"',
  'Mains,Burger,16,mains,,10,"gluten, milk",4.50,"Extras (max 2): Bacon +1.50 | Cheese +1 | Egg +1"',
  "Desserts,Tart,8,desserts,pastry,5,\"gluten, eggs\",1.90,",
].join("\n");

describe.skipIf(!url)("menu, POS and kitchen", () => {
  const sql = postgres(url ?? "", { onnotice: () => {} });
  afterAll(() => sql.end());
  let n = 0;

  async function setup() {
    const tag = `p${Date.now()}${n++}`;
    const [c] = await sql`insert into companies (name, slug) values (${tag}, ${tag}) returning id`;
    const sites = [];
    for (const key of ["a", "b"]) {
      const slug = `${tag}-${key}`;
      const [v] = await sql`insert into venues (company_id, name, slug, service_charge_pct)
                            values (${c!.id}, ${slug}, ${slug}, 12.5) returning id`;
      const [area] = await sql`insert into areas (venue_id, name) values (${v!.id}, 'Main') returning id`;
      for (const label of ["1", "2"]) {
        await sql`insert into tables (venue_id, area_id, label, min_covers, max_covers) values (${v!.id}, ${area!.id}, ${label}, 1, 4)`;
      }
      await sql`insert into stations (venue_id, code, name, kind, sort_order) values
                (${v!.id}, 'kitchen', 'Kitchen', 'kitchen', 0), (${v!.id}, 'bar', 'Bar', 'bar', 1), (${v!.id}, 'pass', 'Pass', 'pass', 2)`;
      sites.push(await getSite(sql, slug));
    }
    const parsed = parseMenuImport(MENU);
    expect(parsed.problems).toEqual([]);
    const imported = await applyImport(sql, c!.id, parsed.items);
    const [s] = await sql`insert into staff_members (company_id, name, role) values (${c!.id}, 'Sam', 'server') returning id`;
    await sql`select set_staff_pin(${s!.id}, '2468')`;
    const menu = await loadMenu(sql, sites[0]!);
    const item = (name: string) => menu.flatMap((c) => c.items).find((i) => i.name === name)!;
    const [t1] = await sql`select id from tables where venue_id = ${sites[0]!.id} and label = '1'`;
    const [t2] = await sql`select id from tables where venue_id = ${sites[0]!.id} and label = '2'`;
    return { companyId: c!.id as string, a: sites[0]!, b: sites[1]!, imported, item, staffId: s!.id as string, t1: t1!.id as string, t2: t2!.id as string };
  }

  it("imports a menu: categories, defaults, modifiers, and creates missing stations", async () => {
    const { a, imported, item } = await setup();
    expect(imported).toEqual({ categoriesCreated: 4, itemsCreated: 7, itemsUpdated: 0, modifierGroups: 2 });
    expect(item("House red")).toMatchObject({ price: 750, course: 0, station: "bar", allergens: ["sulphites"], cost: 210 });
    expect(item("Soup")).toMatchObject({ course: 1, station: "kitchen", prepMinutes: 6 });
    expect(item("Ribeye").modifierGroups[0]).toMatchObject({ name: "Temperature", minSelect: 1, maxSelect: 1 });
    const [pastry] = await sql`select kind::text as kind from stations where venue_id = ${a.id} and code = 'pastry'`;
    expect(pastry).toEqual({ kind: "kitchen" });
  });

  it("re-importing updates instead of duplicating", async () => {
    const { companyId, a } = await setup();
    const again = parseMenuImport(MENU.replace("Soup,7,", "Soup,7.5,"));
    const r = await applyImport(sql, companyId, again.items);
    expect(r).toMatchObject({ categoriesCreated: 0, itemsCreated: 0, itemsUpdated: 7 });
    const soup = (await loadMenu(sql, a)).flatMap((c) => c.items).find((i) => i.name === "Soup")!;
    expect(soup.price).toBe(750);
  });

  it("applies per-site prices and 86s to that site only", async () => {
    const { a, b, item } = await setup();
    await setSitePrice(sql, item("Burger").id, b.id, 1700);
    await setEightySixed(sql, item("Soup").id, a.id, true);
    const at = async (site: typeof a, name: string) => (await loadMenu(sql, site)).flatMap((c) => c.items).find((i) => i.name === name)!;
    expect((await at(a, "Burger")).price).toBe(1600);
    expect((await at(b, "Burger")).price).toBe(1700);
    expect((await at(a, "Soup")).available).toBe(false);
    expect((await at(b, "Soup")).available).toBe(true);
  });

  it("checks staff PINs", async () => {
    const { companyId, staffId } = await setup();
    expect((await listStaff(sql, companyId)).map((s) => s.name)).toEqual(["Sam"]);
    await expect(verifyPin(sql, companyId, staffId, "2468")).resolves.toMatchObject({ name: "Sam" });
    await expect(verifyPin(sql, companyId, staffId, "1111")).rejects.toMatchObject({ code: "pin" });
  });

  it("runs a table from first drink to paid", async () => {
    const { a, item, staffId, t1 } = await setup();
    const t0 = new Date("2026-10-09T18:00:00Z");
    const min = (m: number) => new Date(t0.getTime() + m * 60_000);

    const orderId = await openOrder(sql, a, { tableId: t1, covers: 2, staffId }, t0);
    // Opening again on the same table returns the same check.
    expect(await openOrder(sql, a, { tableId: t1, covers: 2 })).toBe(orderId);

    const ribeye = item("Ribeye");
    const rare = ribeye.modifierGroups[0]!.options.find((o) => o.name === "Rare")!.id;
    await expect(addItem(sql, a, orderId, { menuItemId: ribeye.id })).rejects.toThrow("Choose temperature");
    await addItem(sql, a, orderId, { menuItemId: item("House red").id, quantity: 2, staffId });
    await addItem(sql, a, orderId, { menuItemId: item("Soup").id, seat: 1 });
    await addItem(sql, a, orderId, { menuItemId: item("Burrata").id, seat: 2 });
    await addItem(sql, a, orderId, { menuItemId: ribeye.id, optionIds: [rare], seat: 1, notes: "no chips" });
    const burger = item("Burger");
    const extras = burger.modifierGroups[0]!.options.map((o) => o.id);
    await expect(addItem(sql, a, orderId, { menuItemId: burger.id, optionIds: extras })).rejects.toThrow("Up to 2");
    await addItem(sql, a, orderId, { menuItemId: burger.id, optionIds: extras.slice(0, 2), seat: 2 });

    // Send: drinks and starters go now, mains wait.
    expect(await sendItems(sql, a, orderId, { upTo: 1 }, t0)).toBe(3);
    let o = await getOrder(sql, orderId);
    expect(o.courses.map((c) => [c.course, c.state])).toEqual([
      [0, "cooking"],
      [1, "cooking"],
      [2, "held"],
    ]);
    const bar = await stationQueue(sql, a, "bar", t0);
    expect(bar.tickets).toHaveLength(1);
    expect(bar.tickets[0]!.items.map((i) => [i.name, i.quantity])).toEqual([["House red", 2]]);
    const kitchen = await stationQueue(sql, a, "kitchen", t0);
    expect(kitchen.tickets[0]!.items.map((i) => i.name).sort()).toEqual(["Burrata", "Soup"]);
    // The kitchen can see the mains coming.
    expect(kitchen.tickets[0]!.upcoming.map((u) => u.name).sort()).toEqual(["Burger", "Ribeye"]);

    // Bar makes the drinks: no pass for drinks, so ready = served.
    await readyItems(sql, a, bar.tickets[0]!.id, "all", min(3));
    // Kitchen cooks starters; pass serves them.
    await startItems(sql, a, kitchen.tickets[0]!.id, "all", min(1));
    await readyItems(sql, a, kitchen.tickets[0]!.id, "all", min(7));
    const pass = await stationQueue(sql, a, "pass", min(7));
    expect(pass.tickets.map((t) => t.id)).toContain(kitchen.tickets[0]!.id);
    await serveItems(sql, a, kitchen.tickets[0]!.id, "all", min(8));
    o = await getOrder(sql, orderId);
    expect(o.courses.find((c) => c.course === 1)!.state).toBe("served");

    // Fire mains.
    expect(await sendItems(sql, a, orderId, { only: [2] }, min(25))).toBe(2);
    const mains = (await stationQueue(sql, a, "kitchen", min(25))).tickets.find((t) => t.course === 2)!;
    expect(mains.items.find((i) => i.name === "Ribeye")!.detail).toBe("Rare · no chips");
    await readyItems(sql, a, mains.id, "all", min(40));
    await serveItems(sql, a, mains.id, "all", min(41));

    // Bill: 2×7.50 + 7 + 9.50 + 28 + (16+1.50+1) = 78.00, 10% off, 12.5% service.
    await setDiscount(sql, a, orderId, { kind: "percent", value: 10, reason: "Regular" });
    o = await getOrder(sql, orderId);
    expect(o.totals).toMatchObject({ itemsTotal: 7800, discount: 780, goodsTotal: 7020, serviceCharge: 878, total: 7898 });

    // Split payment, card then cash with change.
    await expect(takePayment(sql, a, orderId, { method: "card", amount: 9000 })).rejects.toThrow("more than is owed");
    expect(await takePayment(sql, a, orderId, { method: "card", amount: 4000, tip: 500, staffId }, min(60))).toEqual({
      closed: false,
      balance: 3898,
      change: 0,
    });
    expect(await takePayment(sql, a, orderId, { method: "cash", amount: 4000 }, min(61))).toEqual({
      closed: true,
      balance: 0,
      change: 102,
    });
    const [closed] = await sql`select status, total_gross, total_vat, total_service, total_discount from orders where id = ${orderId}`;
    expect(closed).toEqual({ status: "paid", total_gross: 7898, total_vat: 1170, total_service: 878, total_discount: 780 });
    // The table is free again.
    expect(await openOrder(sql, a, { tableId: t1, covers: 2 })).not.toBe(orderId);
  });

  it("removes unsent items, voids sent ones with a reason, and comps", async () => {
    const { a, item, t1 } = await setup();
    const orderId = await openOrder(sql, a, { tableId: t1, covers: 1 });
    const soup = await addItem(sql, a, orderId, { menuItemId: item("Soup").id });
    const tart = await addItem(sql, a, orderId, { menuItemId: item("Tart").id });
    await updateHeldItem(sql, a, tart, { quantity: 2 });
    await removeItem(sql, a, tart);
    await sendItems(sql, a, orderId, { upTo: 1 });
    await expect(updateHeldItem(sql, a, soup, { quantity: 3 })).rejects.toThrow("Already sent");
    await expect(removeItem(sql, a, soup)).rejects.toThrow("reason");
    await removeItem(sql, a, soup, "Customer changed mind");
    const red = await addItem(sql, a, orderId, { menuItemId: item("House red").id });
    await compItem(sql, a, red, "Corked bottle");
    const o = await getOrder(sql, orderId);
    expect(o.items.map((i) => [i.name, i.status, i.comped])).toEqual([
      ["House red", "held", true],
      ["Soup", "void", false],
    ]);
    expect(o.totals).toMatchObject({ itemsTotal: 0, compsTotal: 750 });
  });

  it("counts down limited stock and 86s at zero", async () => {
    const { a, item, t1, t2 } = await setup();
    await setStock(sql, item("Ribeye").id, a.id, 2);
    const ribeye = item("Ribeye");
    const opt = ribeye.modifierGroups[0]!.options[0]!.id;
    const o1 = await openOrder(sql, a, { tableId: t1, covers: 2 });
    await addItem(sql, a, o1, { menuItemId: ribeye.id, optionIds: [opt], quantity: 2 });
    const o2 = await openOrder(sql, a, { tableId: t2, covers: 1 });
    // Two are already on a check, so none left for another table.
    await expect(addItem(sql, a, o2, { menuItemId: ribeye.id, optionIds: [opt] })).rejects.toThrow("Only 0 Ribeye left");
    await sendItems(sql, a, o1, { upTo: 9 });
    const after = (await loadMenu(sql, a)).flatMap((c) => c.items).find((i) => i.name === "Ribeye")!;
    expect(after).toMatchObject({ stockRemaining: 0, eightySixed: true, available: false });
  });

  it("links the table's booking, seats it, and finishes it on payment", async () => {
    const { a, item, t1 } = await setup();
    const now = new Date();
    const [g] = await sql`insert into guests (company_id, first_name) values (${a.companyId}, 'Ana') returning id`;
    const [svc] = await sql`insert into services (venue_id, name, days_of_week, first_seating, last_seating)
                            values (${a.id}, 'All day', '{0,1,2,3,4,5,6}', 0, 1439) returning id`;
    const [b] = await sql`insert into bookings (venue_id, service_id, guest_id, covers, starts_at, duration_minutes, status)
                          values (${a.id}, ${svc!.id}, ${g!.id}, 2, ${new Date(now.getTime() - 5 * 60_000)}, 120, 'confirmed') returning id`;
    await sql`insert into booking_tables (booking_id, table_id) values (${b!.id}, ${t1})`;
    const floor = await siteFloor(sql, a, now);
    expect(floor.tables.find((t) => t.id === t1)!.booking).toMatchObject({ guestName: "Ana", status: "confirmed" });

    const orderId = await openOrder(sql, a, { tableId: t1, covers: 2 }, now);
    let o = await getOrder(sql, orderId);
    expect(o).toMatchObject({ bookingId: b!.id, guestId: g!.id, guestName: "Ana" });
    expect((await sql`select status from bookings where id = ${b!.id}`)[0]!.status).toBe("seated");

    await addItem(sql, a, orderId, { menuItemId: item("Negroni").id });
    o = await getOrder(sql, orderId);
    await takePayment(sql, a, orderId, { method: "card", amount: o.totals.total });
    expect((await sql`select status from bookings where id = ${b!.id}`)[0]!.status).toBe("completed");
  });

  it("recalls a bumped ticket, moves checks, and voids unpaid checks", async () => {
    const { a, item, t1, t2 } = await setup();
    const orderId = await openOrder(sql, a, { tableId: t1, covers: 1 });
    await addItem(sql, a, orderId, { menuItemId: item("Soup").id });
    await sendItems(sql, a, orderId, { upTo: 1 });
    const ticket = (await stationQueue(sql, a, "kitchen")).tickets[0]!;
    await readyItems(sql, a, ticket.id, "all");
    await recallTicket(sql, a, ticket.id);
    const again = (await stationQueue(sql, a, "kitchen")).tickets.find((t) => t.id === ticket.id)!;
    expect(again.bumpedAt).toBeNull();
    expect(again.items[0]!.status).toBe("started");

    await moveOrder(sql, a, orderId, t2);
    expect((await getOrder(sql, orderId)).tableLabel).toBe("2");
    await voidOrder(sql, a, orderId, "Walked out");
    const o = await getOrder(sql, orderId);
    expect(o.status).toBe("void");
    expect(o.items.every((i) => i.status === "void")).toBe(true);
  });

  it("keeps sites apart", async () => {
    const { a, b, item, t1 } = await setup();
    const orderId = await openOrder(sql, a, { tableId: t1, covers: 1 });
    await expect(addItem(sql, b, orderId, { menuItemId: item("Soup").id })).rejects.toMatchObject({ code: "not_found" });
    await expect(openOrder(sql, b, { tableId: t1, covers: 1 })).rejects.toMatchObject({ code: "not_found" });
  });
});
