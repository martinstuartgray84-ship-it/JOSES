// Integration tests for the ops forecast and live load. Run via `npm run test:db`.
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getSite, type Site } from "./booking";
import { clearBenchmarkCache } from "./floor";
import { forecastDay, liveOps } from "./ops";

const url = process.env.DATABASE_URL;

describe.skipIf(!url)("operations", () => {
  const sql = postgres(url ?? "", { onnotice: () => {} });
  afterAll(() => sql.end());
  let site: Site;
  const now = new Date("2026-10-09T18:40:00Z"); // Friday 19:40 BST
  const min = (m: number) => new Date(now.getTime() + m * 60_000);

  beforeAll(async () => {
    clearBenchmarkCache();
    const tag = `op${Date.now()}`;
    const [c] = await sql`insert into companies (name, slug) values (${tag}, ${tag}) returning id`;
    const [v] = await sql`insert into venues (company_id, name, slug) values (${c!.id}, ${tag}, ${tag}) returning id`;
    site = await getSite(sql, tag);
    await sql`insert into stations (venue_id, code, name, kind) values (${v!.id}, 'kitchen', 'Kitchen', 'kitchen'), (${v!.id}, 'bar', 'Bar', 'bar'), (${v!.id}, 'pass', 'Pass', 'pass')`;
    const [svc] = await sql`insert into services (venue_id, name, days_of_week, first_seating, last_seating) values (${v!.id}, 'Dinner', '{5}', 1080, 1260) returning id`;
    const [tom] = await sql`insert into staff_members (company_id, name) values (${c!.id}, 'Tom') returning id`;
    const [aisha] = await sql`insert into staff_members (company_id, name) values (${c!.id}, 'Aisha') returning id`;

    // Last 8 Fridays: 4 walk-ins at 19:15 each week; one a Thursday that must not count.
    for (let w = 1; w <= 8; w++) {
      const at = new Date(now.getTime() - w * 7 * 86_400_000 - 25 * 60_000);
      await sql`insert into orders (venue_id, covers, opened_at, status, closed_at, total_gross) values (${site.id}, 4, ${at}, 'open', null, null)`.then(() =>
        sql`update orders set status = 'paid', closed_at = opened_at + interval '90 minutes', total_gross = 1000 where venue_id = ${site.id} and status = 'open'`,
      );
    }
    const thu = new Date(now.getTime() - 86_400_000);
    await sql`insert into orders (venue_id, covers, opened_at) values (${site.id}, 9, ${thu})`;
    await sql`update orders set status = 'paid', closed_at = opened_at + interval '1 hour', total_gross = 1 where venue_id = ${site.id} and status = 'open'`;

    // Tonight: 10 booked at 20:00, 6 already seated at 19:00, a cancellation that doesn't count.
    const book = (covers: number, at: Date, status: string) =>
      sql`insert into bookings (venue_id, service_id, covers, starts_at, duration_minutes, status) values (${site.id}, ${svc!.id}, ${covers}, ${at}, 90, ${status}::booking_status)`;
    await book(10, min(20), "confirmed");
    await book(6, min(-40), "seated");
    await book(8, min(20), "cancelled");

    // Open tables: Tom has 22 guests across two, Aisha 4.
    const open = async (covers: number, by: string, opened: Date) =>
      (await sql`insert into orders (venue_id, covers, opened_by, opened_at, table_label) values (${site.id}, ${covers}, ${by}, ${opened}, 'T') returning id`)[0]!.id as string;
    const t1 = await open(12, tom!.id, min(-30));
    await open(10, tom!.id, min(-20));
    const t3 = await open(4, aisha!.id, min(-25));
    // Kitchen: 30 mains sent 18 min ago (overloaded). Bar: 3 drinks ready 8 min ago.
    await sql`insert into order_items (order_id, venue_id, name, unit_price, quantity, course, station, prep_minutes, status, created_at, sent_at)
              values (${t1}, ${site.id}, 'Steak', 2500, 10, 2, 'kitchen', 14, 'sent', ${min(-18)}, ${min(-18)})`;
    await sql`insert into order_items (order_id, venue_id, name, unit_price, quantity, course, station, prep_minutes, status, created_at, sent_at, ready_at)
              values (${t3}, ${site.id}, 'Negroni', 1000, 3, 0, 'bar', 2, 'ready', ${min(-12)}, ${min(-12)}, ${min(-8)})`;
  });

  it("forecasts tonight from bookings and the same weekday's walk-ins", async () => {
    const f = await forecastDay(sql, site, "2026-10-09", now);
    expect(f.weeksOfHistory).toBe(8);
    expect(f.noShowRate).toBe(0); // the only decided booking (tonight's 19:00) showed up
    const h = (n: number) => f.hours.find((x) => x.hour === n)!;
    expect(h(19)).toMatchObject({ booked: 6, walkIns: 4, arrivals: 10 }); // seated booking not discounted
    expect(h(20)).toMatchObject({ booked: 10, walkIns: 0 });
    expect(h(19).actual).toBe(26); // tables opened this hour so far
    expect(h(20).actual).toBeNull(); // still to come
    expect(f.hours[0]!.hour).toBe(18); // service opens at 18:00
    expect(f.bookedCovers).toBe(16);
    // Staffing re-forecasts from who actually came: 26 seated at 19:00, not the 10 forecast.
    expect(f.staffing.find((s) => s.hour === 19)!.inHouse).toBe(13); // arrived 19:30 on average, half the hour
    expect(f.staffing.find((s) => s.hour === 20)!.inHouse).toBe(26 + 5); // all of them, plus the 20:00 bookings for half
    expect(f.expectedCovers).toBe(36); // 26 here + 10 booked at 20:00 (no walk-ins usually after 19)
  });

  it("shows live load and says what to change", async () => {
    const live = await liveOps(sql, site, now);
    expect(live.stations.map((s) => s.code).sort()).toEqual(["bar", "kitchen"]); // pass has no queue of its own
    const kitchen = live.stations.find((s) => s.code === "kitchen")!;
    expect(kitchen).toMatchObject({ waiting: 10, oldestWaitMinutes: 18, level: "overloaded" });
    expect(live.stations.find((s) => s.code === "bar")).toMatchObject({ readyWaiting: 3, oldestReadyMinutes: 8 });
    expect(live.servers.map((s) => [s.name, s.covers, s.level])).toEqual([
      ["Tom", 22, "overloaded"],
      ["Aisha", 4, "busy"], // drinks waiting and no food order yet
    ]);
    expect(live.arrivingSoon).toBe(10);
    expect(live.alerts.map((a) => a.title)).toEqual([
      "3 drinks waiting at the bar",
      "Kitchen overloaded",
      "Tom has 22 guests, 3 things overdue",
      "Aisha has 4 guests, 2 things overdue",
    ]);
    // Aisha is behind on her one table but still the lightest: she helps Tom. Nobody is light enough to help her.
    expect(live.alerts[2]!.detail).toContain("Aisha (4 guests) picks up Tom's");
    expect(live.alerts[3]!.detail).toBe("Manager or host covers the overdue tables.");
  });
});
