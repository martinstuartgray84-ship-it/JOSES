// Growth Console programme office: actions, decisions, big bets, meeting
// notes and the turn-away tally.

import type { Sql, TransactionSql } from "postgres";
import { MEETING_KINDS, STARTER_ACTIONS, STARTER_BETS, STARTER_DECISIONS, STARTER_IDEAS, type Gate, type MeetingKind } from "../growth/starter";

type Db = Sql | TransactionSql;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const text = (v: unknown, max: number): string => String(v ?? "").trim().slice(0, max);
const optional = (v: unknown, max: number): string | null => text(v, max) || null;
const date = (v: unknown, label: string): string => {
  const s = String(v ?? "");
  if (!DATE.test(s) || Number.isNaN(Date.parse(s))) throw new Error(`${label} must be a date.`);
  return s;
};
const optDate = (v: unknown, label: string): string | null => (v ? date(v, label) : null);
const id = (v: unknown): string => {
  if (typeof v !== "string" || !UUID.test(v)) throw new Error("Not found.");
  return v;
};
const today = (sql: Db, venueId: string) => sql`select (now() at time zone timezone)::date::text as d from venues where id = ${venueId}`.then((r) => r[0]!.d as string);

// --- starter pack ----------------------------------------------------------

/** Load the pack's actions, decisions, first ideas and bet charters. Safe to run twice: nothing is duplicated or overwritten. */
export async function loadStarter(sql: Sql, venueId: string): Promise<{ actions: number; decisions: number; ideas: number; bets: number }> {
  return sql.begin(async (tx) => {
    const n = { actions: 0, decisions: 0, ideas: 0, bets: 0 };
    for (const a of STARTER_ACTIONS)
      n.actions += (await tx`insert into growth_actions (venue_id, ref, owner, task, due) values (${venueId}, ${a.ref}, ${a.owner}, ${a.task}, ${a.due}::date) on conflict do nothing`).count;
    for (const [i, item] of STARTER_DECISIONS.entries())
      n.decisions += (await tx`insert into growth_decisions (venue_id, item, sort) values (${venueId}, ${item}, ${i}) on conflict do nothing`).count;
    for (const [i, b] of STARTER_BETS.entries())
      n.bets += (await tx`insert into growth_bets (venue_id, name, yearly_value, sponsor, lead, measures, stop_rule, status, gates, sort)
                         values (${venueId}, ${b.name}, ${b.yearlyValue}, ${b.sponsor}, ${b.lead}, ${b.measures}, ${b.stopRule}, ${b.status}, ${JSON.stringify(b.gates)}::text::jsonb, ${i})
                         on conflict do nothing`).count;
    // Ideas have no natural key, so they load only onto an empty board.
    const [has] = await tx`select 1 from growth_ideas where venue_id = ${venueId} limit 1`;
    const [tests] = await tx`select 1 from growth_tests where venue_id = ${venueId} limit 1`;
    if (!has && !tests)
      for (const [i, t] of STARTER_IDEAS.entries())
        n.ideas += (await tx`insert into growth_ideas (venue_id, gain_area, change, metric_key, how_to_test, guest_risk, proposer_name, created_at)
                            values (${venueId}, ${t.gainArea}, ${`${t.name}: ${t.change}`}, ${t.metricKey}, ${t.howToTest}, ${t.guestRisk}, 'Starter pack', now() - ${i} * interval '1 second')`).count;
    return n;
  });
}

// --- actions ---------------------------------------------------------------

export interface Action {
  id: string;
  ref: string | null;
  owner: string;
  task: string;
  due: string | null;
  status: "open" | "done" | "dropped";
  notes: string | null;
  doneOn: string | null;
  overdue: boolean;
}
export async function listActions(sql: Db, venueId: string): Promise<Action[]> {
  return sql<Action[]>`
    select a.id, a.ref, a.owner, a.task, a.due::text as due, a.status, a.notes, a.done_on::text as "doneOn",
           (a.status = 'open' and a.due < (now() at time zone v.timezone)::date) as overdue
    from growth_actions a join venues v on v.id = a.venue_id
    where a.venue_id = ${venueId} order by a.owner, a.due nulls last, a.ref, a.created_at`;
}
export async function addAction(sql: Db, venueId: string, input: Record<string, unknown>): Promise<void> {
  const task = text(input.task, 300);
  const owner = text(input.owner, 60);
  if (!task) throw new Error("Say what needs doing.");
  if (!owner) throw new Error("Every action needs an owner.");
  await sql`insert into growth_actions (venue_id, owner, task, due, notes) values (${venueId}, ${owner}, ${task}, ${optDate(input.due, "Due date")}::date, ${optional(input.notes, 500)})`;
}
export async function setActionStatus(sql: Db, venueId: string, actionId: string, status: Action["status"]): Promise<void> {
  if (!["open", "done", "dropped"].includes(status)) throw new Error("Unknown status.");
  const t = await today(sql, venueId);
  await sql`update growth_actions set status = ${status}, done_on = ${status === "done" ? t : null}::date where id = ${id(actionId)} and venue_id = ${venueId}`;
}
export async function editAction(sql: Db, venueId: string, actionId: string, input: Record<string, unknown>): Promise<void> {
  const owner = text(input.owner, 60);
  if (!owner) throw new Error("Every action needs an owner.");
  await sql`update growth_actions set owner = ${owner}, due = ${optDate(input.due, "Due date")}::date, notes = ${optional(input.notes, 500)} where id = ${id(actionId)} and venue_id = ${venueId}`;
}

// --- decisions -------------------------------------------------------------

export interface Decision {
  id: string;
  item: string;
  decision: string | null;
  decidedBy: string | null;
  decidedOn: string | null;
  notes: string | null;
}
export async function listDecisions(sql: Db, venueId: string): Promise<Decision[]> {
  return sql<Decision[]>`select id, item, decision, decided_by as "decidedBy", decided_on::text as "decidedOn", notes
                         from growth_decisions where venue_id = ${venueId} order by sort, created_at`;
}
export async function saveDecision(sql: Db, venueId: string, input: Record<string, unknown>): Promise<void> {
  const decision = optional(input.decision, 500);
  const t = await today(sql, venueId);
  if (input.id) {
    await sql`update growth_decisions set decision = ${decision}, decided_by = ${optional(input.decidedBy, 60)}, notes = ${optional(input.notes, 500)},
              decided_on = case when ${decision}::text is null then null else coalesce(decided_on, ${t}::date) end
              where id = ${id(input.id)} and venue_id = ${venueId}`;
    return;
  }
  const item = text(input.item, 200);
  if (!item) throw new Error("Say what needs deciding.");
  await sql`insert into growth_decisions (venue_id, item, decision, decided_by, notes, decided_on, sort)
            values (${venueId}, ${item}, ${decision}, ${optional(input.decidedBy, 60)}, ${optional(input.notes, 500)}, ${decision ? t : null}::date,
                    (select coalesce(max(sort), 0) + 1 from growth_decisions where venue_id = ${venueId}))
            on conflict (venue_id, item) do update set decision = excluded.decision, decided_by = excluded.decided_by, notes = excluded.notes, decided_on = excluded.decided_on`;
}

// --- big bets --------------------------------------------------------------

export interface Bet {
  id: string;
  name: string;
  yearlyValue: number | null;
  sponsor: string | null;
  lead: string | null;
  measures: string | null;
  stopRule: string | null;
  notes: string | null;
  status: "active" | "parked" | "stopped";
  gates: Gate[];
  /** Gates passed, 0 to 3. */
  passed: number;
}
export async function listBets(sql: Db, venueId: string): Promise<Bet[]> {
  const rows = await sql<Omit<Bet, "passed">[]>`
    select id, name, yearly_value::float8 as "yearlyValue", sponsor, lead, measures, stop_rule as "stopRule", notes, status, gates
    from growth_bets where venue_id = ${venueId} order by sort, created_at`;
  return rows.map((b) => ({ ...b, passed: b.gates.filter((g) => g.status === "passed").length }));
}
export async function saveBet(sql: Db, venueId: string, input: Record<string, unknown>): Promise<void> {
  const name = text(input.name, 120);
  if (!name) throw new Error("Give the bet a name.");
  const value = input.yearlyValue === "" || input.yearlyValue == null ? null : Number(String(input.yearlyValue).replace(/[£,\s]/g, ""));
  if (value != null && (!Number.isFinite(value) || value < 0 || value > 1e9)) throw new Error("Yearly value must be an amount in pounds.");
  const status = String(input.status ?? "active");
  if (!["active", "parked", "stopped"].includes(status)) throw new Error("Unknown status.");
  const t = await today(sql, venueId);
  const gates: Gate[] = [0, 1, 2].map((i) => {
    const s = String(input[`gate_status_${i}`] ?? "pending");
    if (!["pending", "passed", "failed"].includes(s)) throw new Error("Unknown gate status.");
    return { title: ["Gate 1: allowed and feasible", "Gate 2: a pilot made money", "Gate 3: still makes money at scale"][i]!, test: text(input[`gate_test_${i}`], 600), status: s as Gate["status"], decided_on: s === "pending" ? null : optDate(input[`gate_on_${i}`], "Gate date") ?? t };
  });
  if (gates.some((g, i) => g.status === "passed" && gates.slice(0, i).some((p) => p.status !== "passed"))) throw new Error("A gate can only pass once the gates before it have passed.");
  const v = { name, value, sponsor: optional(input.sponsor, 80), lead: optional(input.lead, 80), measures: optional(input.measures, 600), stop: optional(input.stopRule, 600), notes: optional(input.notes, 2000), status, gates: JSON.stringify(gates) };
  if (input.id)
    await sql`update growth_bets set name = ${v.name}, yearly_value = ${v.value}, sponsor = ${v.sponsor}, lead = ${v.lead}, measures = ${v.measures}, stop_rule = ${v.stop},
              notes = ${v.notes}, status = ${v.status}, gates = ${v.gates}::text::jsonb where id = ${id(input.id)} and venue_id = ${venueId}`;
  else
    await sql`insert into growth_bets (venue_id, name, yearly_value, sponsor, lead, measures, stop_rule, notes, status, gates, sort)
              values (${venueId}, ${v.name}, ${v.value}, ${v.sponsor}, ${v.lead}, ${v.measures}, ${v.stop}, ${v.notes}, ${v.status}, ${v.gates}::text::jsonb,
                      (select coalesce(max(sort), 0) + 1 from growth_bets where venue_id = ${venueId}))`;
}

// --- meetings --------------------------------------------------------------

export interface Meeting {
  id: string;
  kind: MeetingKind;
  heldOn: string;
  title: string;
  attendees: string | null;
  notes: string;
}
export async function listMeetings(sql: Db, venueId: string): Promise<Meeting[]> {
  return sql<Meeting[]>`select id, kind, held_on::text as "heldOn", title, attendees, notes from growth_meetings where venue_id = ${venueId} order by held_on desc, created_at desc limit 200`;
}
export async function saveMeeting(sql: Db, venueId: string, input: Record<string, unknown>): Promise<string> {
  const kind = String(input.kind ?? "other") as MeetingKind;
  if (!(kind in MEETING_KINDS)) throw new Error("Unknown kind of meeting.");
  const held = date(input.heldOn, "Date");
  const title = text(input.title, 160) || MEETING_KINDS[kind].label;
  const notes = String(input.notes ?? "").slice(0, 20_000);
  if (input.id) {
    await sql`update growth_meetings set held_on = ${held}::date, title = ${title}, attendees = ${optional(input.attendees, 500)}, notes = ${notes} where id = ${id(input.id)} and venue_id = ${venueId}`;
    return String(input.id);
  }
  const [r] = await sql`insert into growth_meetings (venue_id, kind, held_on, title, attendees, notes) values (${venueId}, ${kind}, ${held}::date, ${title}, ${optional(input.attendees, 500)}, ${notes}) returning id`;
  return r!.id;
}
export async function deleteMeeting(sql: Db, venueId: string, meetingId: string): Promise<void> {
  await sql`delete from growth_meetings where id = ${id(meetingId)} and venue_id = ${venueId}`;
}

// --- turn-aways ------------------------------------------------------------

export interface Turnaway {
  id: string;
  turnedAt: string;
  partySize: number;
  reason: string;
  offeredAlternative: string | null;
}
const STAMP = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;
export async function logTurnaway(sql: Db, venueId: string, input: Record<string, unknown>): Promise<void> {
  const at = String(input.turnedAt ?? "");
  if (!STAMP.test(at) || Number.isNaN(Date.parse(at.slice(0, 16) + "Z"))) throw new Error("Say when it happened.");
  const size = Number(input.partySize);
  if (!Number.isInteger(size) || size < 1 || size > 500) throw new Error("Party size must be a whole number.");
  const reason = text(input.reason, 120);
  if (!reason) throw new Error("Choose a reason.");
  await sql`insert into growth_turnaways (venue_id, turned_at, party_size, reason, offered_alternative)
            values (${venueId}, ${at.slice(0, 16).replace("T", " ")}::timestamp, ${size}, ${reason}, ${optional(input.offeredAlternative, 200)})`;
}
export async function deleteTurnaway(sql: Db, venueId: string, turnawayId: string): Promise<void> {
  await sql`delete from growth_turnaways where id = ${id(turnawayId)} and venue_id = ${venueId}`;
}
export interface TurnawayTally {
  recent: Turnaway[];
  /** Last 28 days on the venue's clock. */
  parties: number;
  guests: number;
  byReason: { reason: string; parties: number; guests: number }[];
  /** Trading day of week (0 = Monday) and hour, as the heatmap uses. */
  bySlot: { dow: number; hour: number; guests: number }[];
}
export async function turnawayTally(sql: Db, venueId: string): Promise<TurnawayTally> {
  const since = sql`(select (now() at time zone timezone) - interval '28 days' from venues where id = ${venueId})`;
  const [recent, byReason, bySlot] = await Promise.all([
    sql<Turnaway[]>`select id, to_char(turned_at, 'YYYY-MM-DD"T"HH24:MI') as "turnedAt", party_size as "partySize", reason, offered_alternative as "offeredAlternative"
                    from growth_turnaways where venue_id = ${venueId} order by turned_at desc limit 100`,
    sql<{ reason: string; parties: number; guests: number }[]>`
      select reason, count(*)::int as parties, sum(party_size)::int as guests from growth_turnaways
      where venue_id = ${venueId} and turned_at >= ${since} group by reason order by guests desc`,
    // A trading day runs 05:00 to 04:59, so shift back five hours before taking the weekday.
    sql<{ dow: number; hour: number; guests: number }[]>`
      select (extract(isodow from turned_at - interval '5 hours')::int - 1) as dow, extract(hour from turned_at)::int as hour, sum(party_size)::int as guests
      from growth_turnaways where venue_id = ${venueId} and turned_at >= ${since} group by 1, 2 order by guests desc limit 5`,
  ]);
  return { recent, byReason, bySlot, parties: byReason.reduce((a, r) => a + r.parties, 0), guests: byReason.reduce((a, r) => a + r.guests, 0) };
}
