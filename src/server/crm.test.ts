// Integration tests for the guest CRM and marketing. Run via `npm run test:db`.
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { guestProfile, listGuests, updateGuest } from "./crm";
import {
  listAutomations,
  listCampaigns,
  recordOpen,
  runAutomations,
  saveAutomation,
  saveCampaign,
  segmentAudience,
  sendCampaign,
  unsubscribe,
} from "./marketing";

const url = process.env.DATABASE_URL;
const DAY = 86_400_000;

describe.skipIf(!url)("CRM and marketing", () => {
  const sql = postgres(url ?? "", { onnotice: () => {} });
  afterAll(() => sql.end());
  const now = new Date("2026-10-09T12:00:00Z");
  let companyId = "";
  let siteA = "";
  const g = {} as Record<"reg" | "lapsed" | "once" | "noconsent" | "noemail", string>;

  async function visit(guest: string, daysAgo: number, total: number, items: [string, number][] = []) {
    const at = new Date(now.getTime() - daysAgo * DAY);
    const [o] = await sql`insert into orders (venue_id, guest_id, covers, opened_at, service_charge_pct)
                          values (${siteA}, ${guest}, 2, ${at}, 0) returning id`;
    for (const [name, course] of items) {
      await sql`insert into order_items (order_id, venue_id, name, unit_price, course, status) values (${o!.id}, ${siteA}, ${name}, 100, ${course}, 'served')`;
    }
    await sql`update orders set status = 'paid', closed_at = ${at}, total_gross = ${total}, total_service = 0 where id = ${o!.id}`;
  }

  beforeAll(async () => {
    const tag = `crm${Date.now()}`;
    const [c] = await sql`insert into companies (name, slug) values ('Jose''s', ${tag}) returning id`;
    companyId = c!.id;
    const [v] = await sql`insert into venues (company_id, name, slug) values (${companyId}, 'Site One', ${tag}) returning id`;
    siteA = v!.id;
    const add = async (key: string, first: string, optIn: boolean, email: string | null = `${key}@x.com`) => {
      const [r] = await sql`insert into guests (company_id, first_name, email, marketing_opt_in) values (${companyId}, ${first}, ${email}, ${optIn}) returning id`;
      g[key as keyof typeof g] = r!.id;
    };
    await add("reg", "Regina", true);
    await add("lapsed", "Lars", true);
    await add("once", "Olive", true);
    await add("noconsent", "Nora", false);
    await add("noemail", "Ned", true, null);
    for (const d of [3, 10, 20, 30, 40]) await visit(g.reg!, d, 6000, [["Ribeye", 2], ["Negroni", 0], ["Ribeye", 2]]);
    for (const d of [60, 90, 120]) await visit(g.lapsed!, d, 4000);
    await visit(g.once!, 5, 3000);
    await visit(g.noconsent!, 70, 2000);
    await visit(g.noconsent!, 80, 2000);
    await visit(g.noconsent!, 85, 2000);
  });

  it("lists guests with stats, searches, and filters by segment", async () => {
    const all = await listGuests(sql, companyId, { now, sort: "visits" });
    expect(all.total).toBe(5);
    expect(all.rows[0]).toMatchObject({ name: "Regina", visits: 5, spend: 30000, mailable: true });
    expect((await listGuests(sql, companyId, { q: "lar", now })).rows.map((r) => r.name)).toEqual(["Lars"]);
    const lapsed = await listGuests(sql, companyId, { segment: { minVisits: 3, lastVisitDaysAgoMin: 45 }, now });
    expect(lapsed.rows.map((r) => r.name).sort()).toEqual(["Lars", "Nora"]);
    expect(lapsed.mailable).toBe(1); // Nora never opted in
  });

  it("builds a profile: favourites, cadence, timeline", async () => {
    const p = (await guestProfile(sql, companyId, g.reg!))!;
    expect(p.stats).toMatchObject({ visits: 5, spend: 30000, avgSpend: 6000, avgPerHead: 3000, avgGapDays: 9 });
    expect(p.favourites[0]).toEqual({ name: "Ribeye", count: 10, drink: false });
    expect(p.timeline).toHaveLength(5);
    expect(await guestProfile(sql, companyId, "00000000-0000-0000-0000-000000000000")).toBeNull();
  });

  it("validates birthdays and records consent", async () => {
    await expect(updateGuest(sql, companyId, g.once!, { birthdayMonth: 2, birthdayDay: 30 })).rejects.toThrow("doesn't exist");
    await expect(updateGuest(sql, companyId, g.once!, { birthdayMonth: 2 })).rejects.toThrow("both");
    await updateGuest(sql, companyId, g.once!, { birthdayMonth: 10, birthdayDay: 12, tags: ["Wine", "wine", " vip "] });
    await updateGuest(sql, companyId, g.noconsent!, { marketingOptIn: true }, "phone call");
    const [row] = await sql`select tags, consent_source, consent_at is not null as has_consent from guests where id = ${g.noconsent}`;
    expect(row).toEqual({ tags: [], consent_source: "phone call", has_consent: true });
    expect((await sql`select tags from guests where id = ${g.once}`)[0]!.tags).toEqual(["wine", "vip"]);
    await updateGuest(sql, companyId, g.noconsent!, { marketingOptIn: false });
  });

  it("sends a campaign only to mailable guests, once, and tracks opens and return visits", async () => {
    expect(await segmentAudience(sql, companyId, {}, now)).toMatchObject({ total: 5, mailable: 3 });
    await expect(saveCampaign(sql, companyId, { name: "x", subject: "Hi {{frist_name}}", body: "b", segment: {} })).rejects.toThrow("Unknown placeholder");
    const id = await saveCampaign(sql, companyId, { name: "Autumn menu", subject: "New menu, {{first_name}}", body: "Come and try it: {{book_url}}", segment: {} });
    const sentAt = new Date(now.getTime() - 20 * DAY);
    const result = await sendCampaign(sql, companyId, id, sentAt);
    // No email provider in tests: recorded as logged, never pretended sent.
    expect(result).toMatchObject({ recipients: 3, logged: 3, sent: 0 });
    await expect(sendCampaign(sql, companyId, id)).rejects.toThrow("already been sent");

    // Backdate the send, then an open and a return visit inside the 30-day window.
    await sql`update campaign_recipients set sent_at = ${sentAt} where campaign_id = ${id}`;
    const [r] = await sql`select token from campaign_recipients where campaign_id = ${id} and guest_id = ${g.lapsed!}`;
    await recordOpen(sql, r!.token);
    await visit(g.lapsed!, 2, 5500);
    const [c] = await listCampaigns(sql, companyId);
    expect(c).toMatchObject({ status: "sent", recipients: 3, logged: 3, opened: 1 });
    // Regina (days 3 and 10) and Olive (day 5) also visited after the send.
    expect(c!.cameBack).toBe(3);
    expect(c!.revenue).toBe(5500 + 6000 + 6000 + 3000);
  });

  it("unsubscribes by token and stops further mail", async () => {
    const [{ unsubscribe_token }] = (await sql`select unsubscribe_token from guests where id = ${g.once!}`) as unknown as [{ unsubscribe_token: string }];
    expect(await unsubscribe(sql, unsubscribe_token)).toEqual({ company: "Jose's" });
    expect(await unsubscribe(sql, "nope")).toBeNull();
    expect((await segmentAudience(sql, companyId, {}, now)).mailable).toBe(2);
  });

  it("runs automations once per occasion", async () => {
    const autos = await listAutomations(sql, companyId);
    expect(autos.map((a) => a.kind).sort()).toEqual(["birthday", "thank_you", "winback"]);
    const winback = autos.find((a) => a.kind === "winback")!;
    await saveAutomation(sql, companyId, "winback", { enabled: true, subject: winback.subject, body: winback.body, params: { lapsedDays: 45, minVisits: 2 } });
    // Clear the campaign's recent sends so the 7-day quiet period doesn't apply.
    await sql`delete from campaign_recipients where campaign_id is not null and guest_id in ${sql(Object.values(g))}`;
    const later = new Date(now.getTime() + 60 * DAY);
    const first = await runAutomations(sql, companyId, later);
    // 60 days on: Regina (last seen 63 days ago) and Lars (62) lapsed; Olive unsubscribed; Nora no consent.
    expect(first.winback).toMatchObject({ queued: 2, logged: 2 });
    const again = await runAutomations(sql, companyId, new Date(later.getTime() + 10 * DAY));
    expect(again.winback!.queued).toBe(0);
  });
});
