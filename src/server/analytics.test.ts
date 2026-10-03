// Integration tests for owner metrics on a small, hand-checkable day.
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  bookingStats,
  busyHeatmap,
  compsAndVoids,
  daily,
  guestStats,
  menuEngineering,
  previousRange,
  speedByHour,
  staffPerformance,
  summary,
  type Range,
} from "./analytics";

const url = process.env.DATABASE_URL;

describe("previousRange", () => {
  it("is the same length, immediately before", () => {
    const r = { companyId: "c", siteIds: [], from: "2026-10-05", to: "2026-10-11", timezone: "Europe/London" };
    expect(previousRange(r)).toMatchObject({ from: "2026-09-28", to: "2026-10-04" });
  });
});

describe.skipIf(!url)("analytics", () => {
  const sql = postgres(url ?? "", { onnotice: () => {} });
  afterAll(() => sql.end());
  let r: Range;

  // Friday 9 Oct 2026, BST (UTC+1).
  const at = (hhmm: string) => new Date(`2026-10-09T${hhmm}:00+01:00`);

  beforeAll(async () => {
    const tag = `an${Date.now()}`;
    const [c] = await sql`insert into companies (name, slug) values (${tag}, ${tag}) returning id`;
    const [v] = await sql`insert into venues (company_id, name, slug) values (${c!.id}, ${tag}, ${tag}) returning id`;
    const [cat] = await sql`insert into menu_categories (company_id, name, default_course) values (${c!.id}, 'Mains', 2) returning id`;
    const [s1] = await sql`insert into staff_members (company_id, name) values (${c!.id}, 'Ann') returning id`;
    const [g1] = await sql`insert into guests (company_id, first_name, email) values (${c!.id}, 'Reg', 'reg@x.com') returning id`;
    const [g2] = await sql`insert into guests (company_id, first_name, email) values (${c!.id}, 'New', 'new@x.com') returning id`;
    const [svc] = await sql`insert into services (venue_id, name, days_of_week, first_seating, last_seating) values (${v!.id}, 'D', '{0,1,2,3,4,5,6}', 0, 1439) returning id`;

    async function check(opts: { guest?: string; opened: string; closed: string; covers: number; lines: [string, number, number, number, string?, string?][]; service?: number; tip?: number; booking?: string }) {
      // lines: [name, course, price, cost, sentHHMM, servedHHMM]
      const [o] = await sql`insert into orders (venue_id, covers, opened_by, opened_at, guest_id, booking_id, service_charge_pct)
                            values (${v!.id}, ${opts.covers}, ${s1!.id}, ${at(opts.opened)}, ${opts.guest ?? null}, ${opts.booking ?? null}, 0) returning id`;
      let gross = 0;
      for (const [name, course, price, cost, sent, served] of opts.lines) {
        gross += price;
        await sql`insert into order_items (order_id, venue_id, name, unit_price, cost, course, prep_minutes, status, created_at, sent_at, ready_at, served_at)
                  values (${o!.id}, ${v!.id}, ${name}, ${price}, ${cost}, ${course}, 10, 'served',
                          ${at(sent ?? opts.opened)}, ${at(sent ?? opts.opened)}, ${at(served ?? opts.closed)}, ${at(served ?? opts.closed)})`;
      }
      const service = opts.service ?? 0;
      await sql`insert into order_payments (order_id, venue_id, method, amount, tip, taken_by, created_at)
                values (${o!.id}, ${v!.id}, 'card', ${gross + service}, ${opts.tip ?? 0}, ${s1!.id}, ${at(opts.closed)})`;
      await sql`update orders set status = 'paid', closed_at = ${at(opts.closed)}, total_gross = ${gross + service},
                total_service = ${service}, total_vat = ${Math.round(gross / 6)}, total_discount = 0 where id = ${o!.id}`;
      return o!.id;
    }

    // Reg was here last week too.
    await check({ guest: g1!.id, opened: "19:00", closed: "20:00", covers: 1, lines: [["Burger", 2, 1200, 400]] });
    await sql`update orders set opened_at = opened_at - interval '7 days', closed_at = closed_at - interval '7 days' where guest_id = ${g1!.id}`;

    const [b] = await sql`insert into bookings (venue_id, service_id, guest_id, covers, starts_at, duration_minutes, status, created_at)
                          values (${v!.id}, ${svc!.id}, ${g1!.id}, 2, ${at("19:00")}, 90, 'completed', ${at("19:00")} - interval '4 days') returning id`;
    await sql`insert into bookings (venue_id, service_id, guest_id, covers, starts_at, duration_minutes, status, created_at)
              values (${v!.id}, ${svc!.id}, ${g2!.id}, 2, ${at("20:00")}, 90, 'no_show', ${at("20:00")} - interval '1 day')`;

    // Two checks today: £60 for 2 (booked, regular) and £30 for 1 (walk-in, new guest).
    await check({
      guest: g1!.id,
      booking: b!.id,
      opened: "19:00",
      closed: "20:30",
      covers: 2,
      service: 600,
      tip: 300,
      lines: [
        ["Wine", 0, 1000, 300, "19:02", "19:06"],
        ["Burger", 2, 1200, 400, "19:20", "19:40"],
        ["Steak", 2, 3800, 1500, "19:20", "19:44"],
      ],
    });
    await check({
      guest: g2!.id,
      opened: "20:00",
      closed: "21:00",
      covers: 1,
      lines: [
        ["Wine", 0, 1000, 300, "20:01", "20:09"],
        ["Burger", 2, 1200, 400, "20:10", "20:22"],
        ["Burger", 2, 800, 400, "20:10", "20:22"], // happy-hour price: still 'Burger'
      ],
    });
    r = { companyId: c!.id, siteIds: [v!.id], from: "2026-10-09", to: "2026-10-09", timezone: "Europe/London" };
  });

  it("summarises sales, covers, spend per head, tips and speed", async () => {
    const s = await summary(sql, r);
    expect(s).toMatchObject({
      sales: 9000, // 60 + 30, service excluded
      service: 600,
      tips: 300,
      checks: 2,
      covers: 3,
      spendPerHead: 3000,
      tableMinutes: 75, // median of 90 and 60
      drinksMinutes: 6, // median of 4 and 8
      foodMinutes: 16, // median of 20, 24, 12, 12 → 16
    });
  });

  it("splits sales by day and by hour", async () => {
    expect(await daily(sql, r)).toEqual([{ date: "2026-10-09", siteId: r.siteIds[0], sales: 9000, covers: 3 }]);
    const hours = await speedByHour(sql, r);
    expect(hours.map((h) => [h.hour, h.drinks, h.food])).toEqual([
      [19, 4, 22],
      [20, 8, 12],
    ]);
  });

  it("counts bookings, no-show rate, lead time and walk-ins", async () => {
    const b = await bookingStats(sql, r);
    expect(b).toMatchObject({ bookings: 2, completed: 1, noShows: 1, noShowRate: 0.5, medianLeadDays: 2.5, walkInShare: 0.5 });
  });

  it("knows new from returning guests", async () => {
    const g = await guestStats(sql, r);
    expect(g).toMatchObject({ guests: 2, returning: 1, newGuests: 1, repeatRate: 0.5 });
    expect(g.top[0]).toMatchObject({ name: "Reg", visits: 1, spend: 6000 });
  });

  it("engineers the menu: margin ex VAT, popularity within food and drinks", async () => {
    const m = await menuEngineering(sql, r);
    const burger = m.find((x) => x.name === "Burger")!;
    // (1200/1.2 − 400) and (1200/1.2 − 400) and (800/1.2 − 400) averaged: (600 + 600 + 266.7) / 3 ≈ 489
    expect(burger).toMatchObject({ group: "food", sold: 3, unitMargin: 489 });
    const steak = m.find((x) => x.name === "Steak")!;
    expect(steak.unitMargin).toBe(1667);
    // Food mix: burger 3/4, steak 1/4; popular at ≥ 70% of 1/2 = 35%.
    expect(burger.class).toBe("plowhorse");
    expect(steak.class).toBe("puzzle");
    expect(m.find((x) => x.name === "Wine")).toMatchObject({ group: "drink", class: "star" });
  });

  it("ranks staff and lists covers by weekday/hour", async () => {
    expect(await staffPerformance(sql, r)).toEqual([{ name: "Ann", checks: 2, covers: 3, sales: 9000, spendPerHead: 3000, tips: 300 }]);
    expect(await busyHeatmap(sql, r)).toEqual(expect.arrayContaining([{ dow: 5, hour: 19, covers: 2 }, { dow: 5, hour: 20, covers: 1 }]));
    expect(await compsAndVoids(sql, r)).toEqual([]);
  });
});
