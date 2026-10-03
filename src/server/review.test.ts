// Regression tests for fixes from the code review. Run via `npm run test:db`.
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { createBooking, getSite, isRealDate, upsertGuest } from "./booking";
import { setBookingStatus } from "./diary";
import { listCampaigns, runAutomations, saveAutomation, saveCampaign, sendCampaign } from "./marketing";
import { loadMenu } from "./menu";
import { addItem, getOrder, openOrder, takePayment, updateHeldItem } from "./orders";
import { loginBlocked, recordLoginFailure, LOGIN_LIMITS } from "./staff";

const url = process.env.DATABASE_URL;

it("rejects dates that don't exist", () => {
  expect(isRealDate("2026-02-28")).toBe(true);
  expect(isRealDate("2028-02-29")).toBe(true);
  expect(isRealDate("2026-02-30")).toBe(false);
  expect(isRealDate("2026-13-01")).toBe(false);
  expect(isRealDate("26-1-1")).toBe(false);
});

describe.skipIf(!url)("review fixes", () => {
  const sql = postgres(url ?? "", { onnotice: () => {} });
  afterAll(() => sql.end());
  let n = 0;

  async function setup() {
    const tag = `rv${Date.now()}${n++}`;
    const [c] = await sql`insert into companies (name, slug) values (${tag}, ${tag}) returning id`;
    const [v] = await sql`insert into venues (company_id, name, slug, min_notice_minutes) values (${c!.id}, ${tag}, ${tag}, 0) returning id`;
    const [area] = await sql`insert into areas (venue_id, name) values (${v!.id}, 'Main') returning id`;
    const [t] = await sql`insert into tables (venue_id, area_id, label, min_covers, max_covers) values (${v!.id}, ${area!.id}, '1', 1, 4) returning id`;
    const [s] = await sql`insert into services (venue_id, name, days_of_week, first_seating, last_seating, buffer_minutes)
                          values (${v!.id}, 'D', '{5}', 1020, 1260, 15) returning id`;
    await sql`insert into service_turn_times values (${s!.id}, 8, 120)`;
    await sql`insert into stations (venue_id, code, name, kind) values (${v!.id}, 'kitchen', 'Kitchen', 'kitchen')`;
    const [cat] = await sql`insert into menu_categories (company_id, name) values (${c!.id}, 'Mains') returning id`;
    await sql`insert into menu_items (company_id, category_id, name, price) values (${c!.id}, ${cat!.id}, 'Steak', 2000)`;
    return { companyId: c!.id as string, site: await getSite(sql, tag), tableId: t!.id as string, serviceId: s!.id as string, slug: tag };
  }
  const now = new Date("2026-10-01T09:00:00Z");

  it("undoing a finish puts the table back on hold for the planned time", async () => {
    const { slug, serviceId } = await setup();
    const b = await createBooking(sql, { siteSlug: slug, date: "2026-10-09", time: 1140, serviceId, covers: 2, guest: { firstName: "A", email: "a@x.com" }, now });
    await setBookingStatus(sql, slug, b.id, "seated", new Date("2026-10-09T18:00:00Z"));
    await setBookingStatus(sql, slug, b.id, "completed", new Date("2026-10-09T18:05:00Z")); // by mistake
    await setBookingStatus(sql, slug, b.id, "seated");
    const [row] = await sql`select duration_minutes from bookings where id = ${b.id}`;
    expect(row!.duration_minutes).toBe(120);
    // So nobody can book the table at 19:30 any more.
    await expect(
      createBooking(sql, { siteSlug: slug, date: "2026-10-09", time: 1170, serviceId, covers: 2, guest: { firstName: "B", email: "b@x.com" }, now }),
    ).rejects.toMatchObject({ code: "unavailable" });
  });

  it("public bookings fill in, never overwrite, and can't undo an unsubscribe", async () => {
    const { companyId } = await setup();
    const id = await upsertGuest(sql, companyId, { firstName: "Ana", lastName: "Real", email: "ana@x.com", phone: "07700900001" });
    await upsertGuest(sql, companyId, { firstName: "X", lastName: "Fake", email: "ANA@x.com", phone: "07700900999", marketingOptIn: true });
    let [g] = await sql`select last_name, phone, marketing_opt_in, consent_source from guests where id = ${id}`;
    expect(g).toEqual({ last_name: "Real", phone: "07700900001", marketing_opt_in: true, consent_source: "online booking" });
    await sql`update guests set marketing_opt_in = false, unsubscribed_at = now() where id = ${id}`;
    await upsertGuest(sql, companyId, { firstName: "Ana", email: "ana@x.com", marketingOptIn: true });
    [g] = await sql`select marketing_opt_in from guests where id = ${id}`;
    expect(g!.marketing_opt_in).toBe(false);
  });

  it("a wrong-day service or off-grid time is a normal 'unavailable', not a crash", async () => {
    const { slug, serviceId } = await setup();
    const base = { siteSlug: slug, serviceId, covers: 2, guest: { firstName: "A", email: "a@x.com" }, now };
    await expect(createBooking(sql, { ...base, date: "2026-10-10", time: 1140 })).rejects.toMatchObject({ code: "unavailable" }); // Saturday
    await expect(createBooking(sql, { ...base, date: "2026-10-09", time: 1147 })).rejects.toMatchObject({ code: "unavailable" });
    await expect(createBooking(sql, { ...base, date: "2026-02-30", time: 1140 })).rejects.toMatchObject({ code: "invalid_date" });
  });

  it("cash records what went towards the bill; held items validate seat and course", async () => {
    const { site, tableId } = await setup();
    const o = await openOrder(sql, site, { tableId, covers: 1 });
    const steak = (await loadMenu(sql, site)).flatMap((c) => c.items)[0]!;
    const item = await addItem(sql, site, o, { menuItemId: steak.id });
    await expect(updateHeldItem(sql, site, item, { course: -1 })).rejects.toThrow("Course must be 0-9");
    await expect(updateHeldItem(sql, site, item, { seat: 0 })).rejects.toThrow("Seat");
    const total = (await getOrder(sql, o)).totals.total;
    const r = await takePayment(sql, site, o, { method: "cash", amount: total + 750 });
    expect(r).toMatchObject({ closed: true, change: 750 });
    const [p] = await sql`select amount from order_payments where order_id = ${o}`;
    expect(p!.amount).toBe(total);
  });

  it("a campaign stuck in 'sending' can be resumed without duplicates", async () => {
    const { companyId } = await setup();
    await sql`insert into guests (company_id, first_name, email, marketing_opt_in) values (${companyId}, 'G', 'g@x.com', true)`;
    const id = await saveCampaign(sql, companyId, { name: "C", subject: "Hi", body: "Body", segment: {} });
    await sql`update campaigns set status = 'sending' where id = ${id}`; // as if the server died
    expect(await sendCampaign(sql, companyId, id)).toMatchObject({ recipients: 1, logged: 1 });
    await expect(sendCampaign(sql, companyId, id)).rejects.toThrow("already been sent");
    expect((await listCampaigns(sql, companyId))[0]).toMatchObject({ status: "sent", recipients: 1 });
  });

  it("birthday emails are keyed to the birthday, not the calendar year", async () => {
    const { companyId } = await setup();
    const [g] = await sql`insert into guests (company_id, first_name, email, marketing_opt_in, birthday_month, birthday_day)
                          values (${companyId}, 'Jan', 'jan@x.com', true, 1, 2) returning id`;
    await saveAutomation(sql, companyId, "birthday", { enabled: true, subject: "Happy birthday", body: "Hi", params: { daysBefore: 7 } });
    const first = await runAutomations(sql, companyId, new Date("2026-12-27T10:00:00Z"));
    expect(first.birthday!.queued).toBe(1);
    // Past the weekly quiet period, still before the birthday: no second email.
    await sql`update campaign_recipients set created_at = created_at - interval '8 days' where guest_id = ${g!.id}`;
    const again = await runAutomations(sql, companyId, new Date("2027-01-01T10:00:00Z"));
    expect(again.birthday!.queued).toBe(0);
  });

  it("blocks one address after repeated wrong passwords", async () => {
    const ip = `test-${Date.now()}`;
    for (let i = 0; i < LOGIN_LIMITS.perIp; i++) await recordLoginFailure(sql, ip);
    expect((await loginBlocked(sql, ip)).blocked).toBe(true);
    expect((await loginBlocked(sql, `${ip}-other`)).blocked).toBe(false);
  });
});
