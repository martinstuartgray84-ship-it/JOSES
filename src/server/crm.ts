// Guest CRM: one profile per person across both sites.

import type { Sql, TransactionSql } from "postgres";
import type { Segment } from "../marketing/segments";

type Db = Sql | TransactionSql;

/**
 * Guests with their visit stats, as a SQL fragment usable in a FROM clause.
 * visits/spend count paid checks; no_shows counts missed bookings.
 */
export function guestStatsFrom(sql: Db, companyId: string) {
  return sql`(
    select g.id, g.first_name, g.last_name, g.email, g.phone, g.tags, g.marketing_opt_in, g.unsubscribed_at,
           g.allergies, g.birthday_month, g.birthday_day, g.created_at,
           coalesce(v.visits, 0)::int as visits, v.last_visit, v.first_visit, coalesce(v.spend, 0)::bigint as spend,
           coalesce(v.sites, '{}') as sites, coalesce(ns.n, 0)::int as no_shows,
           (g.marketing_opt_in and g.unsubscribed_at is null and g.email is not null) as mailable
    from guests g
    left join lateral (
      select count(*) as visits, max(o.closed_at) as last_visit, min(o.closed_at) as first_visit,
             sum(o.total_gross - coalesce(o.total_service, 0)) as spend, array_agg(distinct o.venue_id) as sites
      from orders o where o.guest_id = g.id and o.status = 'paid'
    ) v on true
    left join lateral (select count(*) as n from bookings b where b.guest_id = g.id and b.status = 'no_show') ns on true
    where g.company_id = ${companyId}
  ) gs`;
}

/** WHERE conditions for a segment over `gs` (from guestStatsFrom). */
export function segmentWhere(sql: Db, s: Segment, now: Date) {
  const day = 86_400_000;
  const parts = [sql`true`];
  if (s.minVisits !== undefined) parts.push(sql`gs.visits >= ${s.minVisits}`);
  if (s.maxVisits !== undefined) parts.push(sql`gs.visits <= ${s.maxVisits}`);
  if (s.lastVisitDaysAgoMin !== undefined) parts.push(sql`gs.last_visit <= ${new Date(now.getTime() - s.lastVisitDaysAgoMin * day)}`);
  if (s.lastVisitDaysAgoMax !== undefined) parts.push(sql`gs.last_visit >= ${new Date(now.getTime() - s.lastVisitDaysAgoMax * day)}`);
  if (s.minSpend !== undefined) parts.push(sql`gs.spend >= ${s.minSpend}`);
  if (s.siteId) parts.push(sql`${s.siteId}::uuid = any(gs.sites)`);
  if (s.birthdayThisMonth) parts.push(sql`gs.birthday_month = ${now.getUTCMonth() + 1}`);
  if (s.tag) parts.push(sql`${s.tag} = any(gs.tags)`);
  if (s.hasNoShow) parts.push(sql`gs.no_shows > 0`);
  return parts.reduce((acc, p) => sql`${acc} and ${p}`);
}

export interface GuestRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  tags: string[];
  visits: number;
  lastVisit: Date | null;
  spend: number;
  noShows: number;
  mailable: boolean;
}

export type GuestSort = "recent" | "visits" | "spend" | "name";

export async function listGuests(
  sql: Sql,
  companyId: string,
  opts: { q?: string; segment?: Segment; sort?: GuestSort; limit?: number; offset?: number; now?: Date } = {},
): Promise<{ rows: GuestRow[]; total: number; mailable: number }> {
  const now = opts.now ?? new Date();
  const q = opts.q?.trim();
  const search = q
    ? sql`and (trim(concat_ws(' ', gs.first_name, gs.last_name)) ilike ${"%" + q + "%"} or gs.email ilike ${"%" + q + "%"}
              or regexp_replace(coalesce(gs.phone, ''), '\\D', '', 'g') like ${"%" + q.replace(/\D/g, "") + "%"} and ${q.replace(/\D/g, "").length >= 4})`
    : sql``;
  const order =
    opts.sort === "visits"
      ? sql`gs.visits desc, gs.last_visit desc nulls last`
      : opts.sort === "spend"
        ? sql`gs.spend desc`
        : opts.sort === "name"
          ? sql`gs.first_name, gs.last_name`
          : sql`gs.last_visit desc nulls last, gs.created_at desc`;
  const where = sql`${segmentWhere(sql, opts.segment ?? {}, now)} ${search}`;
  const [rows, [counts]] = await Promise.all([
    sql`select gs.* from ${guestStatsFrom(sql, companyId)} where ${where}
        order by ${order} limit ${opts.limit ?? 50} offset ${opts.offset ?? 0}`,
    sql`select count(*)::int as total, count(*) filter (where gs.mailable)::int as mailable
        from ${guestStatsFrom(sql, companyId)} where ${where}`,
  ]);
  return {
    total: counts!.total,
    mailable: counts!.mailable,
    rows: rows.map((r) => ({
      id: r.id,
      name: [r.first_name, r.last_name].filter(Boolean).join(" ") || "Guest",
      email: r.email,
      phone: r.phone,
      tags: r.tags,
      visits: r.visits,
      lastVisit: r.last_visit,
      spend: Number(r.spend),
      noShows: r.no_shows,
      mailable: r.mailable,
    })),
  };
}

export interface GuestProfile {
  id: string;
  firstName: string;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  tags: string[];
  allergies: string | null;
  birthdayMonth: number | null;
  birthdayDay: number | null;
  marketingOptIn: boolean;
  consentAt: Date | null;
  consentSource: string | null;
  unsubscribedAt: Date | null;
  createdAt: Date;
  stats: {
    visits: number;
    spend: number;
    avgSpend: number;
    avgPerHead: number;
    firstVisit: Date | null;
    lastVisit: Date | null;
    noShows: number;
    cancellations: number;
    avgGapDays: number | null;
  };
  favourites: { name: string; count: number; drink: boolean }[];
  sites: { name: string; visits: number }[];
  timeline: {
    kind: "booking" | "check";
    at: Date;
    site: string;
    covers: number;
    status: string;
    total: number | null;
    id: string;
  }[];
  messages: { subject: string; sentAt: Date | null; openedAt: Date | null; source: string }[];
}

export async function guestProfile(sql: Sql, companyId: string, guestId: string): Promise<GuestProfile | null> {
  if (!/^[0-9a-f-]{36}$/.test(guestId)) return null;
  const [g] = await sql`select * from guests where id = ${guestId} and company_id = ${companyId}`;
  if (!g) return null;
  const [stats, favourites, sites, bookings, checks, messages] = await Promise.all([
    sql`select count(*)::int as visits, coalesce(sum(o.total_gross - coalesce(o.total_service, 0)), 0)::bigint as spend,
               coalesce(sum(o.covers), 0)::int as covers, min(o.closed_at) as first, max(o.closed_at) as last,
               (select count(*) from bookings b where b.guest_id = ${guestId} and b.status = 'no_show')::int as no_shows,
               (select count(*) from bookings b where b.guest_id = ${guestId} and b.status = 'cancelled')::int as cancellations
        from orders o where o.guest_id = ${guestId} and o.status = 'paid'`,
    sql`select i.name, sum(i.quantity)::int as n, bool_or(i.course = 0) as drink
        from order_items i join orders o on o.id = i.order_id
        where o.guest_id = ${guestId} and o.status = 'paid' and i.status <> 'void'
        group by i.name order by n desc limit 8`,
    sql`select v.name, count(*)::int as n from orders o join venues v on v.id = o.venue_id
        where o.guest_id = ${guestId} and o.status = 'paid' group by v.name order by n desc`,
    sql`select b.id, b.starts_at as at, v.name as site, b.covers, b.status::text as status
        from bookings b join venues v on v.id = b.venue_id where b.guest_id = ${guestId}
        order by b.starts_at desc limit 40`,
    sql`select o.id, o.closed_at as at, v.name as site, o.covers, o.status::text as status, o.total_gross as total, o.booking_id
        from orders o join venues v on v.id = o.venue_id where o.guest_id = ${guestId} and o.status = 'paid'
        order by o.closed_at desc limit 40`,
    sql`select coalesce(c.subject, a.subject) as subject, r.sent_at, r.opened_at,
               coalesce(c.name, initcap(replace(a.kind::text, '_', ' '))) as source
        from campaign_recipients r left join campaigns c on c.id = r.campaign_id left join automations a on a.id = r.automation_id
        where r.guest_id = ${guestId} order by r.created_at desc limit 20`,
  ]);
  const s = stats[0]!;
  const visits = s.visits;
  const spend = Number(s.spend);
  const first: Date | null = s.first;
  const last: Date | null = s.last;
  // Bookings that turned into a check are shown once, as the check.
  const bookedChecks = new Set(checks.map((c) => c.booking_id).filter(Boolean));
  return {
    id: g.id,
    firstName: g.first_name,
    lastName: g.last_name,
    email: g.email,
    phone: g.phone,
    notes: g.notes,
    tags: g.tags,
    allergies: g.allergies,
    birthdayMonth: g.birthday_month,
    birthdayDay: g.birthday_day,
    marketingOptIn: g.marketing_opt_in,
    consentAt: g.consent_at,
    consentSource: g.consent_source,
    unsubscribedAt: g.unsubscribed_at,
    createdAt: g.created_at,
    stats: {
      visits,
      spend,
      avgSpend: visits ? Math.round(spend / visits) : 0,
      avgPerHead: s.covers ? Math.round(spend / s.covers) : 0,
      firstVisit: first,
      lastVisit: last,
      noShows: s.no_shows,
      cancellations: s.cancellations,
      avgGapDays: visits > 1 && first && last ? Math.round((last.getTime() - first.getTime()) / 86_400_000 / (visits - 1)) : null,
    },
    favourites: favourites.map((f) => ({ name: f.name, count: f.n, drink: f.drink })),
    sites: sites.map((x) => ({ name: x.name, visits: x.n })),
    timeline: [
      ...checks.map((c) => ({ kind: "check" as const, at: c.at, site: c.site, covers: c.covers, status: "paid", total: Number(c.total), id: c.id })),
      ...bookings
        .filter((b) => !bookedChecks.has(b.id))
        .map((b) => ({ kind: "booking" as const, at: b.at, site: b.site, covers: b.covers, status: b.status, total: null, id: b.id })),
    ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()),
    messages: messages.map((m) => ({ subject: m.subject, sentAt: m.sent_at, openedAt: m.opened_at, source: m.source })),
  };
}

export interface GuestPatch {
  firstName?: string;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  notes?: string | null;
  tags?: string[];
  allergies?: string | null;
  birthdayMonth?: number | null;
  birthdayDay?: number | null;
  marketingOptIn?: boolean;
}

export async function updateGuest(sql: Sql, companyId: string, guestId: string, patch: GuestPatch, source = "staff") {
  const set: Record<string, unknown> = {};
  if (patch.firstName !== undefined) {
    if (!patch.firstName.trim()) throw new Error("First name can't be empty");
    set.first_name = patch.firstName.trim();
  }
  if (patch.lastName !== undefined) set.last_name = patch.lastName?.trim() || null;
  if (patch.email !== undefined) set.email = patch.email?.trim().toLowerCase() || null;
  if (patch.phone !== undefined) set.phone = patch.phone?.replace(/[^\d+]/g, "") || null;
  if (patch.notes !== undefined) set.notes = patch.notes?.trim() || null;
  if (patch.allergies !== undefined) set.allergies = patch.allergies?.trim() || null;
  if (patch.tags !== undefined) set.tags = [...new Set(patch.tags.map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 20);
  if (patch.birthdayMonth !== undefined || patch.birthdayDay !== undefined) {
    const m = patch.birthdayMonth ?? null;
    const d = patch.birthdayDay ?? null;
    if ((m === null) !== (d === null)) throw new Error("Give both the day and the month of their birthday");
    if (m !== null && d !== null) {
      const days = new Date(Date.UTC(2024, m, 0)).getUTCDate(); // leap year allows 29 Feb
      if (d < 1 || d > days) throw new Error("That date doesn't exist");
    }
    set.birthday_month = m;
    set.birthday_day = d;
  }
  if (patch.marketingOptIn !== undefined) {
    set.marketing_opt_in = patch.marketingOptIn;
    if (patch.marketingOptIn) {
      set.consent_at = new Date();
      set.consent_source = source;
      set.unsubscribed_at = null;
    }
  }
  if (Object.keys(set).length === 0) return;
  try {
    const r = await sql`update guests set ${sql(set)} where id = ${guestId} and company_id = ${companyId} returning id`;
    if (!r.length) throw new Error("Guest not found");
  } catch (err) {
    if ((err as { code?: string }).code === "23505") throw new Error("Another guest already has that email");
    throw err;
  }
}
