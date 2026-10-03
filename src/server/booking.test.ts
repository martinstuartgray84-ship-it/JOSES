// Integration tests: run via `npm run test:db`, which provides DATABASE_URL
// pointing at a throwaway Postgres with the migrations applied.
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BookingError, createBooking, siteAvailability } from "./booking";

const url = process.env.DATABASE_URL;
const hm = (h: number, m = 0) => h * 60 + m;

describe.skipIf(!url)("booking service", () => {
  const sql = postgres(url ?? "", { onnotice: () => {} });
  let n = 0;

  /** A fresh company with two sites. Site "a" has two 2-tops and a 4-top; "b" has one 2-top. */
  async function company(opts: { pacing?: number } = {}) {
    const tag = `t${Date.now()}${n++}`;
    const [c] = await sql`insert into companies (name, slug) values (${tag}, ${tag}) returning id`;
    const sites: Record<string, { slug: string; serviceId: string; tableIds: string[] }> = {};
    for (const [key, caps] of [["a", [2, 2, 4]], ["b", [2]]] as const) {
      const slug = `${tag}-${key}`;
      const [v] = await sql`insert into venues (company_id, name, slug, min_notice_minutes)
                            values (${c!.id}, ${slug}, ${slug}, 60) returning id`;
      const [area] = await sql`insert into areas (venue_id, name) values (${v!.id}, 'Main') returning id`;
      const tableIds: string[] = [];
      for (const [i, cap] of caps.entries()) {
        const [t] = await sql`insert into tables (venue_id, area_id, label, min_covers, max_covers)
                              values (${v!.id}, ${area!.id}, ${`T${i + 1}`}, 1, ${cap}) returning id`;
        tableIds.push(t!.id);
      }
      const [s] = await sql`insert into services (venue_id, name, days_of_week, first_seating, last_seating,
                                                  buffer_minutes, max_covers_per_slot)
                            values (${v!.id}, 'Dinner', '{0,1,2,3,4,5,6}', ${hm(17)}, ${hm(21)}, 15, ${opts.pacing ?? null})
                            returning id`;
      await sql`insert into service_turn_times values (${s!.id}, 2, 90), (${s!.id}, 4, 120)`;
      sites[key] = { slug, serviceId: s!.id, tableIds };
    }
    return { companyId: c!.id as string, a: sites.a!, b: sites.b! };
  }

  // A fixed "now" well before the test date, so minimum notice never interferes.
  const now = new Date("2026-10-01T09:00:00Z");
  const date = "2026-10-09";

  const book = (site: { slug: string; serviceId: string }, time: number, extra: Partial<Parameters<typeof createBooking>[1]> = {}) =>
    createBooking(sql, {
      siteSlug: site.slug,
      serviceId: site.serviceId,
      date,
      time,
      covers: 2,
      guest: { firstName: "Ana", email: "ana@example.com" },
      now,
      ...extra,
    });

  beforeAll(async () => {
    await sql`select 1`;
  });
  afterAll(() => sql.end());

  it("offers slots and books the best-fit table", async () => {
    const { a } = await company();
    const { slots } = await siteAvailability(sql, a.slug, date, 2, { now });
    expect(slots.filter((s) => s.available)).toHaveLength(17);
    const booking = await book(a, hm(19));
    // Either 2-top, never the 4-top.
    expect(booking.tableIds).toHaveLength(1);
    expect(a.tableIds.slice(0, 2)).toContain(booking.tableIds[0]);
    // 19:00 in Europe/London on 9 October is BST, so 18:00 UTC.
    expect(booking.startsAt.toISOString()).toBe("2026-10-09T18:00:00.000Z");
    expect(booking.manageToken).toMatch(/^[0-9a-f]{48}$/);
  });

  it("reflects existing bookings in availability", async () => {
    const { b } = await company();
    await book(b, hm(19));
    const { slots } = await siteAvailability(sql, b.slug, date, 2, { now });
    const at = (t: number) => slots.find((s) => s.time === t)!;
    expect(at(hm(19)).available).toBe(false);
    // 90 min dining + 15 min reset must finish by 19:00.
    expect(at(hm(17, 15)).available).toBe(true);
    expect(at(hm(17, 30)).available).toBe(false);
  });

  it("recognises the same guest at both sites", async () => {
    const { a, b } = await company();
    const first = await book(a, hm(18), { guest: { firstName: "Ana", email: "Ana@Example.com", phone: "07700 900123" } });
    const second = await book(b, hm(20), { guest: { firstName: "Ana", email: "ana@example.com" } });
    expect(second.guestId).toBe(first.guestId);
    const [g] = await sql`select phone from guests where id = ${first.guestId}`;
    expect(g!.phone).toBe("07700900123");
  });

  it("matches a phone-only guest across sites", async () => {
    const { a, b } = await company();
    const first = await book(a, hm(18), { guest: { firstName: "Cal", phone: "+44 7700 900456" } });
    const second = await book(b, hm(18), { guest: { firstName: "Cal", phone: "+447700900456" } });
    expect(second.guestId).toBe(first.guestId);
  });

  it("refuses a slot with no table", async () => {
    const { b } = await company();
    await book(b, hm(19));
    await expect(book(b, hm(19, 30))).rejects.toMatchObject({ code: "unavailable" });
  });

  it("respects minimum notice online but not for staff", async () => {
    const { a } = await company();
    const lateNow = new Date("2026-10-09T17:30:00Z"); // 18:30 local
    await expect(book(a, hm(19), { now: lateNow })).rejects.toBeInstanceOf(BookingError);
    await expect(book(a, hm(19), { now: lateNow, channel: "staff" })).resolves.toBeTruthy();
  });

  it("never double-books under concurrent requests", async () => {
    const { a } = await company();
    // Three tables, ten simultaneous requests for the same slot.
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) => book(a, hm(19), { guest: { firstName: `G${i}`, email: `g${i}@example.com` } })),
    );
    const ok = results.filter((r) => r.status === "fulfilled");
    expect(ok).toHaveLength(3);
    const tables = ok.flatMap((r) => (r as PromiseFulfilledResult<{ tableIds: string[] }>).value.tableIds);
    expect(new Set(tables).size).toBe(3);
  });

  it("holds the pacing limit under concurrent requests", async () => {
    // Cap of 4 covers per slot. Parties of different sizes land on different tables,
    // so only the per-day lock (not the table constraint) stops them all getting in.
    for (let round = 0; round < 3; round++) {
      const { a } = await company({ pacing: 4 });
      const sizes = [4, 2, 2, 1, 4, 2];
      const results = await Promise.allSettled(
        sizes.map((covers, i) =>
          book(a, hm(19), { covers, guest: { firstName: `P${i}`, email: `p${i}@example.com` } }),
        ),
      );
      const booked = sizes.filter((_, i) => results[i]!.status === "fulfilled");
      expect(booked.reduce((x, y) => x + y, 0)).toBeLessThanOrEqual(4);
      expect(booked.length).toBeGreaterThan(0);
    }
  });
});
