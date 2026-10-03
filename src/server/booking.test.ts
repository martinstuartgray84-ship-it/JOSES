// Integration tests: run via `npm run test:db`, which provides DATABASE_URL
// pointing at a throwaway Postgres with the migrations applied.
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BookingError, createBooking, createWalkIn, localParts, siteAvailability } from "./booking";
import { sendBookingEmail, sendDueReminders } from "./notify";
import { cancelBookingByToken, getBookingByToken, listSites } from "./manage";
import { loadDiary, setBookingStatus, StatusError } from "./diary";

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

  it("lists only the requested company's sites", async () => {
    const { a, b } = await company();
    const company2 = a.slug.replace(/-a$/, "");
    expect((await listSites(sql, company2)).map((s) => s.slug)).toEqual([a.slug, b.slug]);
  });

  it("lets a guest view and cancel by token, once, and frees the table", async () => {
    const { b } = await company();
    const booking = await book(b, hm(19), { specialRequests: "Window please" });
    const view = await getBookingByToken(sql, booking.manageToken, now);
    expect(view).toMatchObject({ siteSlug: b.slug, covers: 2, status: "confirmed", cancellable: true, firstName: "Ana" });
    expect(await cancelBookingByToken(sql, booking.manageToken, now)).toBe(booking.id);
    expect(await cancelBookingByToken(sql, booking.manageToken, now)).toBeNull();
    expect((await getBookingByToken(sql, booking.manageToken, now))?.cancellable).toBe(false);
    await expect(book(b, hm(19))).resolves.toBeTruthy();
  });

  it("won't cancel after the booking time or with a malformed token", async () => {
    const { b } = await company();
    const booking = await book(b, hm(19));
    expect(await cancelBookingByToken(sql, booking.manageToken, new Date("2026-10-09T19:00:00Z"))).toBeNull();
    expect(await cancelBookingByToken(sql, "' or 1=1 --", now)).toBeNull();
    expect(await getBookingByToken(sql, "nope", now)).toBeNull();
  });

  it("loads the diary: tables, services, bookings with guest history and local times", async () => {
    const { a, b } = await company();
    const x = await book(a, hm(19), { covers: 4, guest: { firstName: "Ana", lastName: "Silva", email: "ana@example.com" } });
    // A past visit at the other site shows up in her history.
    const past = await book(b, hm(18), { guest: { firstName: "Ana", email: "ana@example.com" } });
    await sql`update bookings set status = 'completed' where id = ${past.id}`;

    const diary = await loadDiary(sql, a.slug, date);
    expect(diary.tables.map((t) => t.label)).toEqual(["T1", "T2", "T3"]);
    expect(diary.services).toHaveLength(1);
    expect(diary.bookings).toHaveLength(1);
    expect(diary.bookings[0]).toMatchObject({
      id: x.id,
      start: hm(19),
      covers: 4,
      status: "confirmed",
      guestName: "Ana Silva",
      visits: 1,
      tableIds: x.tableIds,
    });
    // Other days and other sites stay out.
    expect((await loadDiary(sql, a.slug, "2026-10-10")).bookings).toHaveLength(0);
  });

  it("moves bookings through service and frees the table when finished early", async () => {
    const { b } = await company();
    const x = await book(b, hm(19));
    const seatedAt = new Date("2026-10-09T18:05:00Z"); // 19:05 local
    await setBookingStatus(sql, b.slug, x.id, "seated", seatedAt);
    await setBookingStatus(sql, b.slug, x.id, "completed", new Date("2026-10-09T19:00:00Z")); // 20:00 local
    const [row] = await sql`select status, duration_minutes from bookings where id = ${x.id}`;
    expect(row).toMatchObject({ status: "completed", duration_minutes: 60 });
    // The 2-top is free again for a 20:15 booking (19:00 + 90 + 15 would have blocked it).
    await expect(book(b, hm(20, 15))).resolves.toBeTruthy();
  });

  it("refuses invalid moves, other sites' bookings, and reinstating onto a rebooked table", async () => {
    const { a, b } = await company();
    const x = await book(b, hm(19));
    await expect(setBookingStatus(sql, b.slug, x.id, "completed")).rejects.toMatchObject({ code: "not_allowed" });
    await expect(setBookingStatus(sql, a.slug, x.id, "seated")).rejects.toMatchObject({ code: "not_found" });
    await setBookingStatus(sql, b.slug, x.id, "cancelled");
    await book(b, hm(19), { guest: { firstName: "Bo", email: "bo@example.com" } });
    const err = await setBookingStatus(sql, b.slug, x.id, "confirmed").catch((e) => e);
    expect(err).toBeInstanceOf(StatusError);
    expect(err.code).toBe("table_taken");
  });

  it("seats a walk-in now at the best free table, or a chosen one", async () => {
    const { a } = await company();
    const at = new Date("2026-10-09T18:10:00Z"); // 19:10 local
    // Book table 1 from 19:00 so the walk-in has to go elsewhere.
    await book(a, hm(19), { guest: { firstName: "Bo", email: "bo@example.com" } });
    const w = await createWalkIn(sql, { siteSlug: a.slug, covers: 2, now: at });
    const [row] = await sql`select status, channel, starts_at, guest_id from bookings where id = ${w.id}`;
    expect(row).toMatchObject({ status: "seated", channel: "walk_in", guest_id: null });
    expect((row!.starts_at as Date).toISOString()).toBe(at.toISOString());
    expect(w.tableIds).toHaveLength(1);
    // Chosen table that's taken is refused; a free one works and records the guest.
    await expect(createWalkIn(sql, { siteSlug: a.slug, covers: 2, tableId: w.tableIds[0], now: at })).rejects.toThrow("taken or too small");
    const t3 = a.tableIds[2]!;
    const w2 = await createWalkIn(sql, { siteSlug: a.slug, covers: 3, tableId: t3, guest: { firstName: "Cy", phone: "07700 900999" }, now: at });
    expect(w2.tableIds).toEqual([t3]);
    expect(w2.guestId).not.toBe("");
    // Nothing left for a party of 2 now.
    await expect(createWalkIn(sql, { siteSlug: a.slug, covers: 2, now: at })).rejects.toThrow("No free table");
  });

  it("works out local date and time across the clocks going back", () => {
    expect(localParts(new Date("2026-10-25T00:30:00Z"), "Europe/London")).toMatchObject({ date: "2026-10-25", minutes: 90 }); // 01:30 BST
    expect(localParts(new Date("2026-10-25T01:30:00Z"), "Europe/London")).toMatchObject({ date: "2026-10-25", minutes: 90 }); // 01:30 GMT
    expect(localParts(new Date("2026-10-24T23:30:00Z"), "Europe/London")).toMatchObject({ date: "2026-10-25", minutes: 30, dow: 0 });
  });

  it("emails a confirmation once, reminds the day before, and confirms cancellations", async () => {
    const { b } = await company();
    const created = new Date("2026-10-01T09:00:00Z");
    const x = await book(b, hm(19), { guest: { firstName: "Ana", email: "ana@example.com" } });
    await sql`update bookings set created_at = ${created} where id = ${x.id}`;
    expect(await sendBookingEmail(sql, x.id, "confirmation")).toBe("logged");
    expect(await sendBookingEmail(sql, x.id, "confirmation")).toBe("skipped");
    // 19:00 local on the 9th = 18:00Z; reminders go 20–28 hours ahead.
    // The reminder job covers every site, so check this booking's own messages.
    const reminded = async () =>
      (await sql`select count(*)::int as n from booking_messages where booking_id = ${x.id} and kind = 'reminder'`)[0]!.n;
    await sendDueReminders(sql, new Date("2026-10-08T12:00:00Z")); // 30h ahead: too early
    expect(await reminded()).toBe(0);
    await sendDueReminders(sql, new Date("2026-10-08T17:00:00Z")); // 25h ahead
    expect(await reminded()).toBe(1);
    await sendDueReminders(sql, new Date("2026-10-08T18:00:00Z"));
    expect(await reminded()).toBe(1);
    await sql`update bookings set status = 'cancelled' where id = ${x.id}`;
    expect(await sendBookingEmail(sql, x.id, "cancellation")).toBe("logged");
    const kinds = await sql`select kind::text as kind, status::text as status from booking_messages where booking_id = ${x.id} order by kind`;
    expect(kinds).toEqual([
      { kind: "cancellation", status: "logged" },
      { kind: "confirmation", status: "logged" },
      { kind: "reminder", status: "logged" },
    ]);
  });
});
