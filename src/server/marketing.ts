// Campaigns and automations. Only guests who opted in, haven't unsubscribed and
// have an email are ever messaged. Results count real visits, not just opens.

import type { Sql, TransactionSql } from "postgres";
import { segmentSchema, type Segment } from "../marketing/segments";
import { renderEmail, unknownPlaceholders } from "../marketing/template";
import { appUrl, deliver } from "./email";
import { guestStatsFrom, segmentWhere } from "./crm";

type Db = Sql | TransactionSql;

export const ATTRIBUTION_DAYS = 30;

export function parseSegment(raw: unknown): Segment {
  const r = segmentSchema.safeParse(raw ?? {});
  if (!r.success) throw new Error(r.error.issues[0]?.message ?? "That segment isn't valid");
  return r.data;
}

export async function segmentAudience(sql: Sql, companyId: string, segment: Segment, now = new Date()) {
  const where = segmentWhere(sql, segment, now);
  const [c] = await sql`
    select count(*)::int as total, count(*) filter (where gs.mailable)::int as mailable
    from ${guestStatsFrom(sql, companyId)} where ${where}`;
  const sample = await sql`
    select trim(concat_ws(' ', gs.first_name, gs.last_name)) as name from ${guestStatsFrom(sql, companyId)}
    where ${where} and gs.mailable order by gs.last_visit desc nulls last limit 6`;
  return { total: c!.total as number, mailable: c!.mailable as number, sample: sample.map((s) => s.name as string) };
}

// ---------------------------------------------------------------------------
// Campaigns
// ---------------------------------------------------------------------------

export interface CampaignInput {
  name: string;
  subject: string;
  body: string;
  segment: Segment;
}

function checkCopy(input: { subject: string; body: string }) {
  if (!input.subject.trim()) throw new Error("Give it a subject line");
  if (input.subject.length > 150) throw new Error("Keep the subject under 150 characters");
  if (!input.body.trim()) throw new Error("Write the message");
  if (input.body.length > 20_000) throw new Error("That message is too long");
  const unknown = unknownPlaceholders(input.subject + input.body);
  if (unknown.length) throw new Error(`Unknown placeholder${unknown.length > 1 ? "s" : ""}: ${unknown.map((u) => `{{${u}}}`).join(", ")}`);
}

export async function saveCampaign(sql: Sql, companyId: string, input: CampaignInput & { id?: string }): Promise<string> {
  checkCopy(input);
  const segment = parseSegment(input.segment);
  const fallbackName = input.subject.replace(/\{\{.*?\}\}/g, "").replace(/[\s,]+$/, "").trim().slice(0, 60) || "Campaign";
  const row = { name: input.name.trim() || fallbackName, subject: input.subject.trim(), body: input.body, segment: sql.json(segment) };
  if (input.id) {
    const [r] = await sql`update campaigns set ${sql(row)} where id = ${input.id} and company_id = ${companyId} and status = 'draft' returning id`;
    if (!r) throw new Error("Only drafts can be edited");
    return r.id;
  }
  const [r] = await sql`insert into campaigns ${sql({ ...row, company_id: companyId })} returning id`;
  return r!.id;
}

/** Most-visited site per guest, for {{site}}. */
async function usualSites(sql: Db, guestIds: string[]) {
  if (!guestIds.length) return new Map<string, string>();
  const rows = await sql`
    select distinct on (o.guest_id) o.guest_id, v.name from orders o join venues v on v.id = o.venue_id
    where o.guest_id in ${sql(guestIds)} and o.status = 'paid'
    group by o.guest_id, v.name order by o.guest_id, count(*) desc`;
  return new Map(rows.map((r) => [r.guest_id as string, r.name as string]));
}

/** Render and send queued recipients. Returns counts by outcome. */
async function deliverQueued(sql: Sql, companyId: string, recipientIds: string[], copy: (r: { campaign_id: string | null; automation_id: string | null }) => { subject: string; body: string }) {
  if (!recipientIds.length) return { sent: 0, failed: 0, logged: 0 };
  const [company] = await sql`select name from companies where id = ${companyId}`;
  const recips = await sql`
    select r.id, r.token, r.email, r.campaign_id, r.automation_id, r.guest_id, g.first_name, g.last_name, g.unsubscribe_token
    from campaign_recipients r join guests g on g.id = r.guest_id
    where r.id in ${sql(recipientIds)} and r.status = 'queued'`;
  const sites = await usualSites(sql, recips.map((r) => r.guest_id));
  const base = appUrl();
  const messages = recips.map((r) => {
    const { subject, body } = copy(r as unknown as { campaign_id: string | null; automation_id: string | null });
    const unsubscribeUrl = `${base}/u/${r.unsubscribe_token}`;
    const rendered = renderEmail({
      subject,
      body,
      data: {
        first_name: r.first_name ?? "",
        last_name: r.last_name ?? "",
        company: company!.name,
        site: sites.get(r.guest_id) ?? company!.name,
        book_url: `${base}/book`,
      },
      unsubscribeUrl,
      openPixelUrl: `${base}/api/m/o/${r.token}`,
      footer: `You're getting this because you said yes to news from ${company!.name}.`,
    });
    return { to: r.email as string, ...rendered, unsubscribeUrl: `${base}/api/u/${r.unsubscribe_token}` };
  });
  const results = await deliver(messages);
  const counts = { sent: 0, failed: 0, logged: 0 };
  for (const [i, res] of results.entries()) {
    counts[res.status]++;
    await sql`update campaign_recipients set status = ${res.status}, provider_id = ${res.providerId ?? null},
              error = ${res.error ?? null}, sent_at = ${res.status === "failed" ? null : new Date()}
              where id = ${recips[i]!.id}`;
  }
  return counts;
}

/**
 * Send a draft campaign to everyone mailable in its segment right now.
 * Recipients are written first (one per guest), then delivered.
 */
export async function sendCampaign(sql: Sql, companyId: string, campaignId: string, now = new Date()) {
  const [c] = await sql`update campaigns set status = 'sending' where id = ${campaignId} and company_id = ${companyId} and status = 'draft' returning *`;
  if (!c) throw new Error("That campaign has already been sent");
  const segment = parseSegment(c.segment);
  const ids = await sql`
    insert into campaign_recipients (campaign_id, guest_id, email)
    select ${campaignId}, gs.id, gs.email from ${guestStatsFrom(sql, companyId)}
    where ${segmentWhere(sql, segment, now)} and gs.mailable
    on conflict do nothing
    returning id`;
  const counts = await deliverQueued(sql, companyId, ids.map((r) => r.id), () => ({ subject: c.subject, body: c.body }));
  await sql`update campaigns set status = 'sent', sent_at = ${now} where id = ${campaignId}`;
  return { recipients: ids.length, ...counts };
}

/** Send a single test to an address (doesn't touch stats). */
export async function sendTest(sql: Sql, companyId: string, input: { subject: string; body: string; to: string }) {
  checkCopy(input);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.to)) throw new Error("Enter an email address for the test");
  const [company] = await sql`select name from companies where id = ${companyId}`;
  const base = appUrl();
  const rendered = renderEmail({
    subject: `[Test] ${input.subject}`,
    body: input.body,
    data: { first_name: "Alex", company: company!.name, site: company!.name, book_url: `${base}/book` },
    unsubscribeUrl: `${base}/u/test`,
    footer: `You're getting this because you said yes to news from ${company!.name}.`,
  });
  const [res] = await deliver([{ to: input.to, ...rendered, unsubscribeUrl: `${base}/u/test` }]);
  return { ...res!, preview: rendered };
}

export interface CampaignSummary {
  id: string;
  name: string;
  subject: string;
  body: string;
  segment: Segment;
  status: "draft" | "sending" | "sent";
  createdAt: Date;
  sentAt: Date | null;
  recipients: number;
  delivered: number;
  logged: number;
  failed: number;
  opened: number;
  /** Recipients with a paid visit within the attribution window after sending. */
  cameBack: number;
  revenue: number;
}

export async function listCampaigns(sql: Sql, companyId: string): Promise<CampaignSummary[]> {
  const rows = await sql`
    select c.*,
      (select count(*) from campaign_recipients r where r.campaign_id = c.id)::int as recipients,
      (select count(*) from campaign_recipients r where r.campaign_id = c.id and r.status = 'sent')::int as delivered,
      (select count(*) from campaign_recipients r where r.campaign_id = c.id and r.status = 'logged')::int as logged,
      (select count(*) from campaign_recipients r where r.campaign_id = c.id and r.status = 'failed')::int as failed,
      (select count(*) from campaign_recipients r where r.campaign_id = c.id and r.opened_at is not null)::int as opened,
      (select count(distinct r.guest_id) from campaign_recipients r join orders o on o.guest_id = r.guest_id
        where r.campaign_id = c.id and r.sent_at is not null and o.status = 'paid'
          and o.closed_at > r.sent_at and o.closed_at <= r.sent_at + make_interval(days => ${ATTRIBUTION_DAYS}))::int as came_back,
      coalesce((select sum(o.total_gross - coalesce(o.total_service, 0)) from campaign_recipients r join orders o on o.guest_id = r.guest_id
        where r.campaign_id = c.id and r.sent_at is not null and o.status = 'paid'
          and o.closed_at > r.sent_at and o.closed_at <= r.sent_at + make_interval(days => ${ATTRIBUTION_DAYS})), 0)::bigint as revenue
    from campaigns c where c.company_id = ${companyId} order by coalesce(c.sent_at, c.created_at) desc`;
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    subject: r.subject,
    body: r.body,
    segment: r.segment,
    status: r.status,
    createdAt: r.created_at,
    sentAt: r.sent_at,
    recipients: r.recipients,
    delivered: r.delivered,
    logged: r.logged,
    failed: r.failed,
    opened: r.opened,
    cameBack: r.came_back,
    revenue: Number(r.revenue),
  }));
}

export async function deleteDraft(sql: Sql, companyId: string, id: string) {
  const r = await sql`delete from campaigns where id = ${id} and company_id = ${companyId} and status = 'draft' returning id`;
  if (!r.length) throw new Error("Only drafts can be deleted");
}

// ---------------------------------------------------------------------------
// Automations
// ---------------------------------------------------------------------------

export type AutomationKind = "winback" | "thank_you" | "birthday";

export const AUTOMATION_DEFAULTS: Record<AutomationKind, { subject: string; body: string; params: Record<string, number>; title: string; what: string }> = {
  winback: {
    title: "We miss you",
    what: "Regulars who haven't been back for a while.",
    subject: "It's been a while, {{first_name}}",
    body: "Hi {{first_name}},\n\nWe've missed you at {{site}}. The menu has moved on since your last visit and we'd love to cook for you again.\n\nBook a table: {{book_url}}\n\nSee you soon,\nThe team at {{company}}",
    params: { lapsedDays: 45, minVisits: 2 },
  },
  thank_you: {
    title: "Thanks for coming",
    what: "The morning after a visit, with a nudge to leave a review.",
    subject: "Thanks for coming in, {{first_name}}",
    body: "Hi {{first_name}},\n\nThank you for joining us at {{site}}. We hope you had a lovely time.\n\nIf you did, a quick review helps us more than you'd think. And if anything wasn't right, just reply to this email.\n\nThe team at {{company}}",
    params: { afterHours: 12 },
  },
  birthday: {
    title: "Birthday",
    what: "A week before a guest's birthday (needs their birthday on file).",
    subject: "Happy birthday from {{company}}",
    body: "Hi {{first_name}},\n\nYour birthday's coming up, so the first drink's on us when you celebrate at {{site}}. Just mention it when you book.\n\n{{book_url}}\n\nThe team at {{company}}",
    params: { daysBefore: 7 },
  },
};

export interface AutomationView {
  id: string;
  kind: AutomationKind;
  enabled: boolean;
  subject: string;
  body: string;
  params: Record<string, number>;
  lastRunAt: Date | null;
  sent30d: number;
  cameBack30d: number;
}

export async function ensureAutomations(sql: Sql, companyId: string) {
  for (const [kind, d] of Object.entries(AUTOMATION_DEFAULTS)) {
    await sql`insert into automations (company_id, kind, subject, body, params)
              values (${companyId}, ${kind}, ${d.subject}, ${d.body}, ${sql.json(d.params)})
              on conflict (company_id, kind) do nothing`;
  }
}

export async function listAutomations(sql: Sql, companyId: string): Promise<AutomationView[]> {
  await ensureAutomations(sql, companyId);
  const rows = await sql`
    select a.*,
      (select count(*) from campaign_recipients r where r.automation_id = a.id and r.created_at > now() - interval '30 days')::int as sent30,
      (select count(distinct r.guest_id) from campaign_recipients r join orders o on o.guest_id = r.guest_id
        where r.automation_id = a.id and r.created_at > now() - interval '30 days' and r.sent_at is not null and o.status = 'paid'
          and o.closed_at > r.sent_at and o.closed_at <= r.sent_at + make_interval(days => ${ATTRIBUTION_DAYS}))::int as back30
    from automations a where a.company_id = ${companyId} order by a.kind`;
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    enabled: r.enabled,
    subject: r.subject,
    body: r.body,
    params: { ...AUTOMATION_DEFAULTS[r.kind as AutomationKind].params, ...r.params },
    lastRunAt: r.last_run_at,
    sent30d: r.sent30,
    cameBack30d: r.back30,
  }));
}

export async function saveAutomation(
  sql: Sql,
  companyId: string,
  kind: AutomationKind,
  input: { enabled: boolean; subject: string; body: string; params: Record<string, number> },
) {
  checkCopy(input);
  const allowed = Object.keys(AUTOMATION_DEFAULTS[kind].params);
  const params: Record<string, number> = {};
  for (const k of allowed) {
    const v = Number(input.params[k]);
    if (!Number.isInteger(v) || v < 0 || v > 3650) throw new Error(`${k} must be a whole number`);
    params[k] = v;
  }
  await ensureAutomations(sql, companyId);
  await sql`update automations set enabled = ${input.enabled}, subject = ${input.subject.trim()}, body = ${input.body},
            params = ${sql.json(params)} where company_id = ${companyId} and kind = ${kind}`;
}

/** Guests each automation should message now, with the occasion that makes it unique. */
async function due(sql: Sql, companyId: string, a: AutomationView, now: Date): Promise<{ guestId: string; email: string; occasion: string }[]> {
  const base = sql`from ${guestStatsFrom(sql, companyId)} where gs.mailable
    and not exists (select 1 from campaign_recipients r where r.guest_id = gs.id and r.created_at > ${new Date(now.getTime() - 7 * 86_400_000)})`;
  if (a.kind === "winback") {
    const lapsed = new Date(now.getTime() - a.params.lapsedDays! * 86_400_000);
    const rows = await sql`select gs.id, gs.email, gs.last_visit ${base}
                           and gs.visits >= ${a.params.minVisits!} and gs.last_visit <= ${lapsed}`;
    // A guest who comes back and lapses again is a new occasion.
    return rows.map((r) => ({ guestId: r.id, email: r.email, occasion: `lapse:${(r.last_visit as Date).toISOString().slice(0, 10)}` }));
  }
  if (a.kind === "thank_you") {
    const until = new Date(now.getTime() - a.params.afterHours! * 3_600_000);
    const since = new Date(until.getTime() - 24 * 3_600_000);
    // One thank-you per visit; skip anyone messaged in the last week.
    const rows = await sql`
      select g.id, g.email, (array_agg(o.id order by o.closed_at desc))[1] as order_id
      from orders o join guests g on g.id = o.guest_id
      where g.company_id = ${companyId} and o.status = 'paid' and o.closed_at > ${since} and o.closed_at <= ${until}
        and g.marketing_opt_in and g.unsubscribed_at is null and g.email is not null
        and not exists (select 1 from campaign_recipients r where r.guest_id = g.id and r.created_at > ${new Date(now.getTime() - 7 * 86_400_000)})
      group by g.id, g.email`;
    return rows.map((r) => ({ guestId: r.id, email: r.email, occasion: `visit:${r.order_id}` }));
  }
  // Birthday: within the next N days (month/day, ignoring year), once per year.
  const days = a.params.daysBefore!;
  const targets: { m: number; d: number }[] = [];
  for (let i = 0; i <= days; i++) {
    const t = new Date(now.getTime() + i * 86_400_000);
    targets.push({ m: t.getUTCMonth() + 1, d: t.getUTCDate() });
  }
  const rows = await sql`select gs.id, gs.email, gs.birthday_month, gs.birthday_day ${base} and gs.birthday_month is not null`;
  return rows
    .filter((r) => targets.some((t) => t.m === r.birthday_month && t.d === r.birthday_day))
    .map((r) => ({ guestId: r.id, email: r.email, occasion: `birthday:${now.getUTCFullYear()}` }));
}

/** Run every enabled automation once. Safe to call repeatedly: occasions never repeat. */
export async function runAutomations(sql: Sql, companyId: string, now = new Date()) {
  const autos = (await listAutomations(sql, companyId)).filter((a) => a.enabled);
  const out: Record<string, { queued: number; sent: number; logged: number; failed: number }> = {};
  for (const a of autos) {
    const candidates = await due(sql, companyId, a, now);
    const recipientIds: string[] = [];
    for (const c of candidates) {
      await sql.begin(async (tx) => {
        const claimed = await tx`insert into automation_sends (automation_id, guest_id, occasion) values (${a.id}, ${c.guestId}, ${c.occasion})
                                 on conflict do nothing returning guest_id`;
        if (!claimed.length) return;
        const [r] = await tx`insert into campaign_recipients (automation_id, guest_id, email) values (${a.id}, ${c.guestId}, ${c.email}) returning id`;
        await tx`update automation_sends set recipient_id = ${r!.id} where automation_id = ${a.id} and guest_id = ${c.guestId} and occasion = ${c.occasion}`;
        recipientIds.push(r!.id);
      });
    }
    const counts = await deliverQueued(sql, companyId, recipientIds, () => ({ subject: a.subject, body: a.body }));
    await sql`update automations set last_run_at = ${now} where id = ${a.id}`;
    out[a.kind] = { queued: recipientIds.length, ...counts };
  }
  return out;
}

// ---------------------------------------------------------------------------
// Public endpoints
// ---------------------------------------------------------------------------

const TOKEN = /^[0-9a-f]{36}$/;

export async function unsubscribe(sql: Sql, token: string): Promise<{ company: string } | null> {
  if (!TOKEN.test(token)) return null;
  const [r] = await sql`
    update guests g set unsubscribed_at = coalesce(g.unsubscribed_at, now()), marketing_opt_in = false
    from companies c where g.unsubscribe_token = ${token} and c.id = g.company_id returning c.name`;
  return r ? { company: r.name } : null;
}

export async function companyForUnsubscribe(sql: Sql, token: string): Promise<{ company: string; done: boolean } | null> {
  if (!TOKEN.test(token)) return null;
  const [r] = await sql`select c.name, g.unsubscribed_at from guests g join companies c on c.id = g.company_id where g.unsubscribe_token = ${token}`;
  return r ? { company: r.name, done: !!r.unsubscribed_at } : null;
}

export async function recordOpen(sql: Sql, token: string) {
  if (!TOKEN.test(token)) return;
  await sql`update campaign_recipients set opened_at = coalesce(opened_at, now()) where token = ${token}`;
}
