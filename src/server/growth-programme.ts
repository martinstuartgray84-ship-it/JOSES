// Growth Console programme: ideas, tests, gains, the bridge, the weekly
// scorecard and events. Readouts and values come from src/growth/engine.

import type { Sql, TransactionSql } from "postgres";
import {
  DESIGNS, METRICS, VERDICTS, bridgeDefaults, dayFromIso, eventNetGain, fmt, isMetric, isoDay, liveTestWarnings, pctChange, readout, scorecard, weekOf, yearlyValue,
  type BridgeInput, type Design, type MetricKey, type Model, type Readout, type Scorecard,
} from "../growth/engine";
import { appUrl, deliver } from "./email";
import { getSettings, loadModel, loadStored } from "./growth";

type Db = Sql | TransactionSql;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const text = (v: unknown, max: number): string => String(v ?? "").trim().slice(0, max);
const optional = (v: unknown, max: number): string | null => text(v, max) || null;
const money = (v: unknown, label: string): number => {
  const n = Number(String(v ?? "").replace(/[£,\s]/g, "") || 0);
  if (!Number.isFinite(n) || n < 0 || n > 99_999_999) throw new Error(`${label} must be an amount in pounds.`);
  return Math.round(n * 100) / 100;
};
const date = (v: unknown, label: string): string => {
  const s = String(v ?? "");
  if (!DATE.test(s) || Number.isNaN(Date.parse(s))) throw new Error(`${label} must be a date.`);
  return s;
};
const id = (v: unknown): string => {
  if (typeof v !== "string" || !UUID.test(v)) throw new Error("Not found.");
  return v;
};

/** Today's date on the venue's clock. */
export async function venueToday(sql: Db, venueId: string): Promise<string> {
  const [r] = await sql`select (now() at time zone timezone)::date::text as d from venues where id = ${venueId}`;
  return r!.d;
}

// --- ideas -----------------------------------------------------------------

export interface Idea {
  id: string;
  gainArea: string;
  change: string;
  metricKey: string;
  howToTest: string | null;
  guestRisk: string | null;
  proposerName: string | null;
  status: "open" | "testing" | "declined";
  createdAt: Date;
}
export async function listIdeas(sql: Db, venueId: string): Promise<Idea[]> {
  return sql<Idea[]>`
    select id, gain_area as "gainArea", change, metric_key as "metricKey", how_to_test as "howToTest", guest_risk as "guestRisk",
           proposer_name as "proposerName", status, created_at as "createdAt"
    from growth_ideas where venue_id = ${venueId} order by created_at desc`;
}
export async function addIdea(sql: Db, venueId: string, input: { gainArea: unknown; change: unknown; metricKey: unknown; howToTest?: unknown; guestRisk?: unknown; proposerName?: unknown }): Promise<string> {
  const change = text(input.change, 500);
  if (!change) throw new Error("Say what would change.");
  if (!isMetric(input.metricKey)) throw new Error("Choose the number it should move.");
  const [r] = await sql`
    insert into growth_ideas (venue_id, gain_area, change, metric_key, how_to_test, guest_risk, proposer_name)
    values (${venueId}, ${text(input.gainArea, 60) || "Floor service"}, ${change}, ${input.metricKey}, ${optional(input.howToTest, 500)},
            ${optional(input.guestRisk, 500)}, ${optional(input.proposerName, 60)}) returning id`;
  return r!.id;
}
export async function setIdeaStatus(sql: Db, venueId: string, ideaId: string, status: "open" | "declined"): Promise<void> {
  await sql`update growth_ideas set status = ${status} where id = ${id(ideaId)} and venue_id = ${venueId} and status <> 'testing'`;
}

// --- tests -----------------------------------------------------------------

export type TestStatus = "planned" | "live" | "read" | "banked" | "stopped";
export interface TestRow {
  id: string;
  ideaId: string | null;
  name: string;
  gainArea: string;
  metricKey: MetricKey;
  guardrailKey: MetricKey | null;
  design: Design;
  testTables: string[];
  startDay: string;
  endDay: string | null;
  passMarkPct: number;
  ownerName: string | null;
  status: TestStatus;
  result: Readout | null;
  decidedBy: string | null;
  decidedAt: Date | null;
  notes: string | null;
}
export async function listTests(sql: Db, venueId: string): Promise<TestRow[]> {
  return sql<TestRow[]>`
    select id, idea_id as "ideaId", name, gain_area as "gainArea", metric_key as "metricKey", guardrail_key as "guardrailKey", design,
           test_tables as "testTables", start_day::text as "startDay", end_day::text as "endDay", pass_mark_pct::float8 as "passMarkPct",
           owner_name as "ownerName", status, result, decided_by as "decidedBy", decided_at as "decidedAt", notes
    from growth_tests where venue_id = ${venueId}
    order by array_position(array['live', 'planned', 'read', 'banked', 'stopped'], status), start_day desc, created_at desc`;
}

/** The readout for a test as the data stands now. */
export function readTest(m: Model, t: Pick<TestRow, "metricKey" | "guardrailKey" | "design" | "startDay" | "endDay" | "passMarkPct" | "testTables">): Readout {
  return readout(m, { metric: t.metricKey, guardrail: t.guardrailKey, design: t.design, startDay: dayFromIso(t.startDay), endDay: t.endDay ? dayFromIso(t.endDay) : null, passMarkPct: t.passMarkPct, tables: t.testTables });
}

export interface TestInput {
  ideaId?: unknown;
  name: unknown;
  gainArea: unknown;
  metricKey: unknown;
  guardrailKey?: unknown;
  design: unknown;
  testTables?: unknown;
  startDay: unknown;
  endDay?: unknown;
  passMarkPct: unknown;
  ownerName?: unknown;
  notes?: unknown;
  /** Start it now rather than leave it planned. */
  live?: boolean;
}
export async function createTest(sql: Sql, venueId: string, input: TestInput): Promise<string> {
  const name = text(input.name, 120);
  if (!name) throw new Error("Give the test a name.");
  if (!isMetric(input.metricKey)) throw new Error("Choose the primary metric.");
  const guardrail = input.guardrailKey ? (isMetric(input.guardrailKey) ? input.guardrailKey : null) : null;
  if (guardrail === input.metricKey) throw new Error("The guardrail must be a different number from the primary metric.");
  const design = String(input.design) as Design;
  if (!(design in DESIGNS)) throw new Error("Choose a design.");
  const tables = String(input.testTables ?? "").split(/[,\n]/).map((s) => s.trim()).filter(Boolean).slice(0, 200);
  if (design === "split_section" && !tables.length) throw new Error("List the tables in the test section, separated by commas.");
  const start = date(input.startDay, "Start date");
  const end = input.endDay ? date(input.endDay, "End date") : null;
  if (end && end < start) throw new Error("The end date is before the start date.");
  const pass = Number(input.passMarkPct);
  if (!Number.isFinite(pass) || pass === 0 || Math.abs(pass) > 1000) throw new Error("Set a pass mark, such as 5 for +5%.");
  const ideaId = input.ideaId ? id(input.ideaId) : null;
  return sql.begin(async (tx) => {
    const [r] = await tx`
      insert into growth_tests (venue_id, idea_id, name, gain_area, metric_key, guardrail_key, design, test_tables, start_day, end_day, pass_mark_pct, owner_name, notes, status)
      values (${venueId}, ${ideaId}, ${name}, ${text(input.gainArea, 60) || "Floor service"}, ${input.metricKey as string}, ${guardrail}, ${design}, ${tables},
              ${start}::date, ${end}::date, ${pass}, ${optional(input.ownerName, 60)}, ${optional(input.notes, 2000)}, ${input.live ? "live" : "planned"})
      returning id`;
    if (ideaId) await tx`update growth_ideas set status = 'testing' where id = ${ideaId} and venue_id = ${venueId}`;
    return r!.id as string;
  });
}

export async function startTest(sql: Db, venueId: string, testId: string): Promise<void> {
  await sql`update growth_tests set status = 'live' where id = ${id(testId)} and venue_id = ${venueId} and status = 'planned'`;
}

/** Read a live test: freeze the readout as it stands. The decision comes next. */
export async function markRead(sql: Sql, venueId: string, testId: string): Promise<Readout> {
  const t = (await listTests(sql, venueId)).find((x) => x.id === id(testId));
  if (!t) throw new Error("Not found.");
  if (t.status !== "live" && t.status !== "read") throw new Error("Only a live test can be read.");
  const m = await loadModel(sql, venueId);
  if (!m) throw new Error("Load till data before reading a test.");
  const r = readTest(m, t);
  if (r.verdict === "not_started") throw new Error("There is no data yet from the test's start date. Load a newer till export first.");
  const today = await venueToday(sql, venueId);
  await sql`update growth_tests set status = 'read', result = ${JSON.stringify(r)}::text::jsonb,
            end_day = coalesce(end_day, least(${today}::date, ${isoDay(m.maxDay)}::date)) where id = ${t.id}`;
  return r;
}

/** Bank a read test as a gain, or stop it. Records who decided and when. */
export async function decideTest(sql: Sql, venueId: string, testId: string, input: { decision: "bank" | "stop"; decidedBy: unknown; yearlyValue?: unknown; notes?: unknown }): Promise<void> {
  const by = text(input.decidedBy, 60);
  if (!by) throw new Error("Add the name of who made the decision.");
  const today = await venueToday(sql, venueId);
  await sql.begin(async (tx) => {
    const [t] = await tx`select id, status, result, idea_id from growth_tests where id = ${id(testId)} and venue_id = ${venueId} for update`;
    if (!t) throw new Error("Not found.");
    if (input.decision === "bank") {
      if (t.status !== "read") throw new Error("Read the test before banking it.");
      const change = (t.result as Readout | null)?.primary.change;
      if (change == null) throw new Error("This test has no measured change to bank.");
      const value = input.yearlyValue === "" || input.yearlyValue == null ? null : money(input.yearlyValue, "Yearly value");
      await tx`insert into growth_gains (venue_id, test_id, change_pct, yearly_value, banked_on, recheck_day)
               values (${venueId}, ${t.id}, ${Math.round(change * 100_000) / 1000}, ${value}, ${today}::date, ${today}::date + 90)`;
    } else if (!["planned", "live", "read"].includes(t.status)) throw new Error("That test is already decided.");
    await tx`update growth_tests set status = ${input.decision === "bank" ? "banked" : "stopped"}, decided_by = ${by}, decided_at = now(),
             notes = coalesce(${optional(input.notes, 2000)}, notes) where id = ${t.id}`;
    if (t.idea_id && input.decision === "stop") await tx`update growth_ideas set status = 'open' where id = ${t.idea_id} and status = 'testing'`;
  });
}

// --- gains -----------------------------------------------------------------

export interface Gain {
  id: string;
  testId: string;
  name: string;
  gainArea: string;
  metricKey: MetricKey;
  changePct: number;
  yearlyValue: number | null;
  bankedOn: string;
  recheckDay: string;
  stillHolding: boolean | null;
  /** The 90-day re-check is due and not yet done. */
  recheckDue: boolean;
}
export async function listGains(sql: Db, venueId: string): Promise<Gain[]> {
  return sql<Gain[]>`
    select g.id, g.test_id as "testId", t.name, t.gain_area as "gainArea", t.metric_key as "metricKey", g.change_pct::float8 as "changePct",
           g.yearly_value::float8 as "yearlyValue", g.banked_on::text as "bankedOn", g.recheck_day::text as "recheckDay", g.still_holding as "stillHolding",
           (g.still_holding is null and g.recheck_day <= (now() at time zone v.timezone)::date) as "recheckDue"
    from growth_gains g join growth_tests t on t.id = g.test_id join venues v on v.id = g.venue_id
    where g.venue_id = ${venueId} order by g.banked_on desc, t.name`;
}
/** Banked value a year. A gain that failed its 90-day re-check no longer counts. */
export const gainsTotal = (gains: Gain[]): number => gains.reduce((a, g) => a + (g.stillHolding === false ? 0 : (g.yearlyValue ?? 0)), 0);

export async function recheckGain(sql: Db, venueId: string, gainId: string, holding: boolean): Promise<void> {
  await sql`update growth_gains set still_holding = ${holding}, rechecked_on = ${await venueToday(sql, venueId)}::date where id = ${id(gainId)} and venue_id = ${venueId}`;
}

/** Everything the gains board and tests page need, with live readouts. */
export async function programme(sql: Sql, venueId: string) {
  const [ideas, tests, gains, m] = await Promise.all([listIdeas(sql, venueId), listTests(sql, venueId), listGains(sql, venueId), loadModel(sql, venueId)]);
  const withRead = tests.map((t) => {
    // A decided or read test keeps the readout it was judged on.
    const now = m && (t.status === "live" || t.status === "planned") ? readTest(m, t) : null;
    const read = t.result ?? now;
    return { ...t, read, suggestedValue: m && read ? yearlyValue(m, read.primary) : null };
  });
  const live = withRead.filter((t) => t.status === "live");
  return { ideas, tests: withRead, gains, total: gainsTotal(gains), warnings: liveTestWarnings(live.map((t) => ({ name: t.name, metric: t.metricKey }))), hasData: !!m };
}

// --- bridge ----------------------------------------------------------------

export async function getBridge(sql: Db, venueId: string): Promise<Partial<BridgeInput> | null> {
  const [r] = await sql`select assumptions from growth_bridge where venue_id = ${venueId}`;
  return r ? r.assumptions : null;
}
export async function saveBridge(sql: Db, venueId: string, input: Record<string, unknown> | null): Promise<void> {
  if (input == null) {
    await sql`delete from growth_bridge where venue_id = ${venueId}`;
    return;
  }
  const clean: Record<string, number> = {};
  for (const k of Object.keys(bridgeDefaults(0))) {
    const n = Number(input[k]);
    if (!Number.isFinite(n) || n < 0 || n > 1e10) throw new Error("Each assumption must be a number, zero or more.");
    clean[k] = n;
  }
  if (!(clean.target! >= 1)) throw new Error("The target multiple must be 1 or more.");
  await sql`insert into growth_bridge (venue_id, assumptions) values (${venueId}, ${JSON.stringify(clean)}::text::jsonb)
            on conflict (venue_id) do update set assumptions = excluded.assumptions, updated_at = now()`;
}

// --- weekly scorecard ------------------------------------------------------

export interface ScorecardPayload extends Scorecard {
  weekStart: string;
  liveTests: { name: string; metric: string; verdict: string; tone: string; change: number | null; weeks: number }[];
  gainsThisWeek: { name: string; changePct: number; yearlyValue: number | null }[];
  bankedTotal: number;
}
export interface StoredScorecard {
  weekStart: string;
  payload: ScorecardPayload;
  createdAt: Date;
  emailedAt: Date | null;
  emailedTo: string[];
}

/** Build and save the scorecard for the trading week starting on Monday `weekStart`. Null if no sales are loaded for it. */
export async function buildScorecard(sql: Sql, venueId: string, weekStart: string): Promise<ScorecardPayload | null> {
  const week = dayFromIso(date(weekStart, "Week"));
  if (weekOf(week) !== week) throw new Error("A scorecard week starts on a Monday.");
  const stored = await loadStored(sql, venueId);
  if (!stored || !stored.days.some((d) => d.day >= week && d.day <= week + 6 && d.checks > 0)) return null;
  const p = await programme(sql, venueId);
  const m = await loadModel(sql, venueId);
  const payload: ScorecardPayload = {
    ...scorecard(stored.source, week),
    weekStart,
    liveTests: p.tests.filter((t) => t.status === "live").map((t) => {
      const r = m ? readTest(m, { ...t, endDay: isoDay(Math.min(week + 6, t.endDay ? dayFromIso(t.endDay) : Infinity)) }) : null;
      return { name: t.name, metric: METRICS[t.metricKey].label, verdict: r ? VERDICTS[r.verdict].label : "No data", tone: r ? VERDICTS[r.verdict].tone : "", change: r?.primary.change ?? null, weeks: r?.weeks ?? 0 };
    }),
    gainsThisWeek: p.gains.filter((g) => g.bankedOn >= weekStart && g.bankedOn <= isoDay(week + 6)).map((g) => ({ name: g.name, changePct: g.changePct, yearlyValue: g.yearlyValue })),
    bankedTotal: p.total,
  };
  await sql`insert into growth_scorecards (venue_id, week_start, payload) values (${venueId}, ${weekStart}::date, ${JSON.stringify(payload)}::text::jsonb)
            on conflict (venue_id, week_start) do update set payload = excluded.payload, created_at = now()`;
  return payload;
}

export async function listScorecards(sql: Db, venueId: string, limit = 26): Promise<StoredScorecard[]> {
  return sql<StoredScorecard[]>`
    select week_start::text as "weekStart", payload, created_at as "createdAt", emailed_at as "emailedAt", emailed_to as "emailedTo"
    from growth_scorecards where venue_id = ${venueId} order by week_start desc limit ${limit}`;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const arrow = (ch: number | null, better: number) => (ch == null || Math.abs(ch) < 0.005 ? "" : ch * better > 0 ? "▲" : "▼");

export function renderScorecardEmail(venueName: string, siteSlug: string, p: ScorecardPayload): { subject: string; html: string; text: string } {
  const subject = `${venueName}: scorecard for ${p.label}`;
  const url = `${appUrl()}/growth/${siteSlug}/scorecard?week=${p.weekStart}`;
  const rows = p.tiles.map((t) => ({ label: t.label, value: fmt(t.fmt, t.value), wk: `${arrow(t.onPriorWeek, t.better)} ${pctChange(t.onPriorWeek)}`.trim(), four: `${arrow(t.onFourWeek, t.better)} ${pctChange(t.onFourWeek)}`.trim() }));
  const tests = p.liveTests.map((t) => `${t.name}: ${t.verdict}${t.change == null ? "" : `, ${pctChange(t.change)} on ${t.metric.toLowerCase()}`}`);
  const gains = p.gainsThisWeek.map((g) => `${g.name}: ${pctChange(g.changePct / 100)}${g.yearlyValue == null ? "" : `, about ${fmt("money0", g.yearlyValue)} a year`}`);
  const text = [
    `Scorecard for ${p.label}`, "",
    ...rows.map((r) => `${r.label}: ${r.value} (${r.wk} on prior week, ${r.four} on four-week average)`), "",
    "Live tests", ...(tests.length ? tests : ["None live."]), "",
    "Gains banked this week", ...(gains.length ? gains : ["None this week."]), "",
    `Banked so far: ${fmt("money0", p.bankedTotal)} a year`, "", url,
  ].join("\n");
  const td = 'style="padding:6px 10px;border-bottom:1px solid #e3ddd3;text-align:right;white-space:nowrap"';
  const th = 'style="padding:6px 10px;border-bottom:1px solid #e3ddd3;text-align:left"';
  const list = (items: string[], none: string) => (items.length ? `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>` : `<p>${none}</p>`);
  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1f1b16;max-width:640px">
<h2 style="margin:0 0 4px">${esc(venueName)}</h2><p style="margin:0 0 16px;color:#6b635a">Scorecard for ${esc(p.label)}</p>
<table style="border-collapse:collapse;width:100%;font-size:14px"><tr><th ${th}>Measure</th><th ${td}>This week</th><th ${td}>On prior week</th><th ${td}>On four-week average</th></tr>
${rows.map((r) => `<tr><td ${th}>${esc(r.label)}</td><td ${td}><strong>${esc(r.value)}</strong></td><td ${td}>${esc(r.wk)}</td><td ${td}>${esc(r.four)}</td></tr>`).join("\n")}</table>
<h3>Live tests</h3>${list(tests, "None live.")}
<h3>Gains banked this week</h3>${list(gains, "None this week.")}
<p><strong>Banked so far: ${esc(fmt("money0", p.bankedTotal))} a year</strong></p>
<p><a href="${esc(url)}">Open the scorecard</a></p></div>`;
  return { subject, html, text };
}

/** Email a saved scorecard to the venue's scorecard list. Returns how many were sent (or logged, without an email provider). */
export async function emailScorecard(sql: Sql, venueId: string, weekStart: string): Promise<{ to: string[]; status: string }> {
  const [row] = await sql`select s.payload, v.name, v.slug from growth_scorecards s join venues v on v.id = s.venue_id where s.venue_id = ${venueId} and s.week_start = ${weekStart}::date`;
  if (!row) throw new Error("Build the scorecard first.");
  const { scorecardEmails: to } = await getSettings(sql, venueId);
  if (!to.length) return { to, status: "no_recipients" };
  const mail = renderScorecardEmail(row.name, row.slug, row.payload);
  const results = await deliver(to.map((address) => ({ to: address, ...mail })));
  const failed = results.find((r) => r.status === "failed");
  if (failed) throw new Error(`The email provider refused the scorecard: ${failed.error}`);
  await sql`update growth_scorecards set emailed_at = now(), emailed_to = ${to} where venue_id = ${venueId} and week_start = ${weekStart}::date`;
  return { to, status: results[0]?.status ?? "sent" };
}

/**
 * Called hourly, and after each import. From Monday 07:00 on the venue's
 * clock, builds last week's scorecard once its sales are loaded and emails it.
 * Each week is built and sent at most once here.
 */
export async function runScorecards(sql: Sql, opts: { venueId?: string; now?: Date } = {}): Promise<{ built: number; emailed: number }> {
  const now = opts.now ?? new Date();
  const due = await sql`
    select v.id, (date_trunc('week', ${now}::timestamptz at time zone v.timezone)::date - 7)::text as week
    from venues v join growth_settings s on s.venue_id = v.id
    where (${opts.venueId ?? null}::uuid is null or v.id = ${opts.venueId ?? null})
      and (${now}::timestamptz at time zone v.timezone) >= date_trunc('week', ${now}::timestamptz at time zone v.timezone) + interval '7 hours'
      and not exists (select 1 from growth_scorecards c where c.venue_id = v.id and c.week_start = date_trunc('week', ${now}::timestamptz at time zone v.timezone)::date - 7)`;
  let built = 0;
  let emailed = 0;
  for (const v of due) {
    if (!(await buildScorecard(sql, v.id, v.week))) continue;
    built++;
    try {
      if ((await emailScorecard(sql, v.id, v.week)).to.length) emailed++;
    } catch (err) {
      console.error("scorecard email failed", v.id, err);
    }
  }
  return { built, emailed };
}

// --- events ----------------------------------------------------------------

export type Outcome = "open" | "booked" | "lost" | "no_reply";
export interface Enquiry {
  id: string;
  receivedAt: string;
  source: string | null;
  eventType: string | null;
  requestedFor: string | null;
  partySize: number | null;
  quote: number | null;
  firstReplyAt: string | null;
  /** Hours from enquiry to first reply. */
  responseHours: number | null;
  outcome: Outcome;
  lostReason: string | null;
}
const STAMP = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;
const stamp = (v: unknown, label: string): string => {
  const s = String(v ?? "");
  if (!STAMP.test(s) || Number.isNaN(Date.parse(s.slice(0, 16) + "Z"))) throw new Error(`${label} must be a date and time.`);
  return s.slice(0, 16).replace("T", " ");
};

export async function listEnquiries(sql: Db, venueId: string): Promise<Enquiry[]> {
  return sql<Enquiry[]>`
    select id, to_char(received_at, 'YYYY-MM-DD"T"HH24:MI') as "receivedAt", source, event_type as "eventType", requested_for::text as "requestedFor",
           party_size as "partySize", quote::float8 as quote, to_char(first_reply_at, 'YYYY-MM-DD"T"HH24:MI') as "firstReplyAt",
           (extract(epoch from first_reply_at - received_at) / 3600)::float8 as "responseHours", outcome, lost_reason as "lostReason"
    from growth_enquiries where venue_id = ${venueId} order by received_at desc limit 500`;
}
export async function saveEnquiry(sql: Db, venueId: string, input: Record<string, unknown>): Promise<void> {
  const received = stamp(input.receivedAt, "Received");
  const reply = input.firstReplyAt ? stamp(input.firstReplyAt, "First reply") : null;
  if (reply && reply < received) throw new Error("The first reply is before the enquiry arrived.");
  const outcome = String(input.outcome ?? "open");
  if (!["open", "booked", "lost", "no_reply"].includes(outcome)) throw new Error("Unknown outcome.");
  const size = input.partySize === "" || input.partySize == null ? null : Number(input.partySize);
  if (size != null && (!Number.isInteger(size) || size < 1 || size > 100_000)) throw new Error("Size must be a whole number of guests.");
  const v = {
    received, source: optional(input.source, 80), type: optional(input.eventType, 80), requested: input.requestedFor ? date(input.requestedFor, "Requested date") : null,
    size, quote: input.quote === "" || input.quote == null ? null : money(input.quote, "Quote"), reply, outcome, reason: outcome === "lost" ? optional(input.lostReason, 300) : null,
  };
  if (input.id) {
    await sql`update growth_enquiries set received_at = ${v.received}::timestamp, source = ${v.source}, event_type = ${v.type}, requested_for = ${v.requested}::date,
              party_size = ${v.size}, quote = ${v.quote}, first_reply_at = ${v.reply}::timestamp, outcome = ${v.outcome}, lost_reason = ${v.reason}
              where id = ${id(input.id)} and venue_id = ${venueId}`;
  } else {
    await sql`insert into growth_enquiries (venue_id, received_at, source, event_type, requested_for, party_size, quote, first_reply_at, outcome, lost_reason)
              values (${venueId}, ${v.received}::timestamp, ${v.source}, ${v.type}, ${v.requested}::date, ${v.size}, ${v.quote}, ${v.reply}::timestamp, ${v.outcome}, ${v.reason})`;
  }
}
export async function deleteEnquiry(sql: Db, venueId: string, enquiryId: string): Promise<void> {
  await sql`delete from growth_enquiries where id = ${id(enquiryId)} and venue_id = ${venueId}`;
}

export interface EventRow {
  id: string;
  name: string;
  heldOn: string;
  space: string | null;
  guests: number | null;
  revenue: number;
  costOfGoods: number;
  extraLabour: number;
  directCosts: number;
  displacedSales: number;
  contributionRate: number;
  netGain: number;
}
export async function listEvents(sql: Db, venueId: string): Promise<EventRow[]> {
  const rows = await sql<Omit<EventRow, "netGain">[]>`
    select id, name, held_on::text as "heldOn", space, guests, revenue::float8 as revenue, cost_of_goods::float8 as "costOfGoods",
           extra_labour::float8 as "extraLabour", direct_costs::float8 as "directCosts", displaced_sales::float8 as "displacedSales",
           contribution_rate::float8 as "contributionRate"
    from growth_events where venue_id = ${venueId} order by held_on desc limit 500`;
  return rows.map((e) => ({ ...e, netGain: eventNetGain(e) }));
}
export async function saveEvent(sql: Db, venueId: string, input: Record<string, unknown>): Promise<void> {
  const name = text(input.name, 120);
  if (!name) throw new Error("Give the event a name.");
  const rate = Number(input.contributionRate ?? 55) / 100;
  if (!Number.isFinite(rate) || rate < 0 || rate > 1) throw new Error("Contribution rate is a percentage from 0 to 100.");
  const guests = input.guests === "" || input.guests == null ? null : Number(input.guests);
  if (guests != null && (!Number.isInteger(guests) || guests < 0 || guests > 100_000)) throw new Error("Guests must be a whole number.");
  const v = {
    name, held: date(input.heldOn, "Date"), space: optional(input.space, 80), guests, revenue: money(input.revenue, "Revenue"), cogs: money(input.costOfGoods, "Cost of goods"),
    labour: money(input.extraLabour, "Extra labour"), direct: money(input.directCosts, "Direct costs"), displaced: money(input.displacedSales, "Displaced sales"), rate,
  };
  if (input.id) {
    await sql`update growth_events set name = ${v.name}, held_on = ${v.held}::date, space = ${v.space}, guests = ${v.guests}, revenue = ${v.revenue}, cost_of_goods = ${v.cogs},
              extra_labour = ${v.labour}, direct_costs = ${v.direct}, displaced_sales = ${v.displaced}, contribution_rate = ${v.rate} where id = ${id(input.id)} and venue_id = ${venueId}`;
  } else {
    await sql`insert into growth_events (venue_id, name, held_on, space, guests, revenue, cost_of_goods, extra_labour, direct_costs, displaced_sales, contribution_rate)
              values (${venueId}, ${v.name}, ${v.held}::date, ${v.space}, ${v.guests}, ${v.revenue}, ${v.cogs}, ${v.labour}, ${v.direct}, ${v.displaced}, ${v.rate})`;
  }
}
export async function deleteEvent(sql: Db, venueId: string, eventId: string): Promise<void> {
  await sql`delete from growth_events where id = ${id(eventId)} and venue_id = ${venueId}`;
}
