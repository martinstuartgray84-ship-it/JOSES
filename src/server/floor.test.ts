// Integration tests for benchmarks and the live floor. Run via `npm run test:db`.
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getSite, type Site } from "./booking";
import { clearBenchmarkCache, liveFloor, siteBenchmark } from "./floor";
import { DEFAULT_BENCHMARK } from "../tables/coach";

const url = process.env.DATABASE_URL;

describe.skipIf(!url)("floor coach", () => {
  const sql = postgres(url ?? "", { onnotice: () => {} });
  afterAll(() => sql.end());
  let site: Site;
  let tableId = "";
  const item: Record<string, string> = {};
  const now = new Date("2026-10-09T18:40:00Z"); // 19:40 BST, a Friday

  beforeAll(async () => {
    clearBenchmarkCache();
    const tag = `fl${Date.now()}`;
    const [c] = await sql`insert into companies (name, slug) values (${tag}, ${tag}) returning id`;
    const [v] = await sql`insert into venues (company_id, name, slug) values (${c!.id}, ${tag}, ${tag}) returning id`;
    const [area] = await sql`insert into areas (venue_id, name) values (${v!.id}, 'Main') returning id`;
    const [t] = await sql`insert into tables (venue_id, area_id, label, min_covers, max_covers) values (${v!.id}, ${area!.id}, '7', 1, 4) returning id`;
    tableId = t!.id;
    const cats: Record<string, string> = {};
    for (const [name, course] of [["Cocktails", 0], ["Red wine", 0], ["Hot drinks", 0], ["Mains", 2], ["Desserts", 3]] as const) {
      const [r] = await sql`insert into menu_categories (company_id, name, default_course) values (${c!.id}, ${name}, ${course}) returning id`;
      cats[name] = r!.id;
    }
    for (const [name, cat, price] of [["Negroni", "Cocktails", 1000], ["Rioja", "Red wine", 3600], ["Espresso", "Hot drinks", 300], ["Steak", "Mains", 2500], ["Tart", "Desserts", 800]] as const) {
      const [r] = await sql`insert into menu_items (company_id, category_id, name, price) values (${c!.id}, ${cats[cat]!}, ${name}, ${price}) returning id`;
      item[name] = r!.id;
    }
    site = await getSite(sql, tag);

    // 24 past dinners for two: negroni ×2 at 3 min, steak ×2 at 15 min, tart ×1 at 70 min; paid at 100 min.
    for (let d = 1; d <= 24; d++) {
      const opened = new Date(now.getTime() - d * 86_400_000 - 30 * 60_000);
      const m = (x: number) => new Date(opened.getTime() + x * 60_000);
      const [o] = await sql`insert into orders (venue_id, covers, opened_at, service_charge_pct) values (${site.id}, 2, ${opened}, 0) returning id`;
      for (const [name, qty, course, atMin] of [["Negroni", 2, 0, 3], ["Steak", 2, 2, 15], ["Tart", 1, 3, 70]] as const) {
        const price = name === "Negroni" ? 1000 : name === "Steak" ? 2500 : 800;
        await sql`insert into order_items (order_id, venue_id, menu_item_id, name, unit_price, quantity, course, status, created_at)
                  values (${o!.id}, ${site.id}, ${item[name]!}, ${name}, ${price}, ${qty}, ${course}, 'served', ${m(atMin)})`;
      }
      await sql`update orders set status = 'paid', closed_at = ${m(100)}, total_gross = 7800, total_service = 0 where id = ${o!.id}`;
    }
  });

  it("learns a benchmark from the site's own history", async () => {
    const lunchB = await siteBenchmark(sql, site, "lunch", now);
    expect(lunchB).toBe(DEFAULT_BENCHMARK); // no lunch history: defaults
    const b = await siteBenchmark(sql, site, "dinner", now);
    expect(b.finalPerHead).toBe(3900);
    expect(b.dwellMinutes).toBe(100);
    const at = (m: number) => b.spendCurve.find(([x]) => x === m)![1];
    expect(at(0)).toBe(0);
    expect(at(10)).toBe(1000); // two negronis between two
    expect(at(30)).toBe(3500); // plus two steaks
    expect(at(90)).toBe(3900); // plus the tart
    expect(b.avgPrice).toMatchObject({ drink: 1000, dessert: 800 });
    expect(b.attach.dessert).toBe(0.5);
    expect(b.attach.secondRound).toBe(0);
  });

  it("coaches a live table: regular's usual drink, turn pressure from the next booking", async () => {
    const [g] = await sql`insert into guests (company_id, first_name) values (${site.companyId}, 'Ana') returning id`;
    // Ana's history: she always has a negroni.
    const [past] = await sql`insert into orders (venue_id, covers, guest_id, opened_at, status, closed_at, total_gross)
                             values (${site.id}, 1, ${g!.id}, ${new Date(now.getTime() - 40 * 86_400_000)}, 'open', null, null) returning id`;
    await sql`insert into order_items (order_id, venue_id, name, unit_price, quantity, course, status) values (${past!.id}, ${site.id}, 'Negroni', 1000, 3, 0, 'served')`;
    await sql`update orders set status = 'paid', closed_at = opened_at + interval '1 hour', total_gross = 3000 where id = ${past!.id}`;

    const opened = new Date(now.getTime() - 6 * 60_000);
    await sql`insert into orders (venue_id, table_id, table_label, covers, guest_id, opened_at) values (${site.id}, ${tableId}, '7', 2, ${g!.id}, ${opened})`;
    const [svc] = await sql`insert into services (venue_id, name, days_of_week, first_seating, last_seating) values (${site.id}, 'D', '{5}', 1020, 1290) returning id`;
    const [nb] = await sql`insert into bookings (venue_id, service_id, covers, starts_at, duration_minutes, status)
                           values (${site.id}, ${svc!.id}, 4, ${new Date(now.getTime() + 15 * 60_000)}, 90, 'confirmed') returning id`;
    await sql`insert into booking_tables (booking_id, table_id) values (${nb!.id}, ${tableId})`;

    const floor = await liveFloor(sql, site, now);
    expect(floor.tables).toHaveLength(1);
    const t = floor.tables[0]!;
    expect(t.result.stage).toBe("seated");
    expect(t.result.mustTurn).toBe(true);
    expect(t.result.nudges.map((n) => n.kind)).toEqual(expect.arrayContaining(["turn", "first_drink"]));
    expect(t.result.nudges.find((n) => n.kind === "first_drink")!.detail).toContain("Ana usually has Negroni");
    expect(floor.totals).toMatchObject({ tables: 1, covers: 2, urgent: 1 });
  });
});
