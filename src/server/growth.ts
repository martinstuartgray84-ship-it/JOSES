// Growth Console data: venue settings, CSV import, stored summaries and the
// model the views read. All numbers come from src/growth/engine.

import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Sql, TransactionSql } from "postgres";
import { csvCells, csvRows, toRow } from "../growth/csv";
import {
  DAY, FIELDS, applyMap, autoMap, bizDay, build, dayRows, hourRows, isoDay, parseBooking, parseCheck, parseItem, storedSource,
  type BookingRow, type CheckRow, type DayRow, type FileKind, type HourRow, type ItemRow, type Model, type Parsed, type Source,
} from "../growth/engine";

type Db = Sql | TransactionSql;
const EPOCH = "1970-01-01";

// --- sites -----------------------------------------------------------------

export interface ProgrammeSite {
  id: string;
  slug: string;
  name: string;
}
/**
 * The company's sites with the programme's site first. The programme runs at
 * one site, the first one set up; the order must not change when a site is
 * renamed, so it never sorts by name.
 */
export async function programmeSites(sql: Db, companySlug?: string): Promise<ProgrammeSite[]> {
  return sql<ProgrammeSite[]>`
    select v.id, v.slug, v.name from venues v join companies c on c.id = v.company_id
    where ${companySlug ?? null}::text is null or c.slug = ${companySlug ?? null}
    order by v.created_at, v.slug`;
}

// --- settings --------------------------------------------------------------

export const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export const GAIN_AREAS = ["Welcome and bookings", "Floor service", "Bar", "Kitchen", "Events and hire", "Guests and reputation", "Cost and margin", "Team"];
export type ServerRole = "owner" | "manager" | "host";

export interface GrowthSettings {
  /** The programme's name, chosen by the team. */
  programmeName: string;
  seats: number;
  barSeats: number | null;
  /** Per day: [open, close] as "HH:MM", or null when closed. */
  tradingHours: Record<string, [string, string] | null>;
  serverFiguresMinRole: ServerRole;
  gainAreas: { name: string; captain: string }[];
  scorecardEmails: string[];
  dataVersion: number;
}

export async function getSettings(sql: Db, venueId: string): Promise<GrowthSettings> {
  await sql`insert into growth_settings (venue_id, gain_areas)
            values (${venueId}, ${JSON.stringify(GAIN_AREAS.map((name) => ({ name, captain: "" })))}::text::jsonb)
            on conflict (venue_id) do nothing`;
  const [r] = await sql`
    select programme_name, seats, bar_seats, trading_hours, server_figures_min_role, gain_areas, scorecard_emails, data_version
    from growth_settings where venue_id = ${venueId}`;
  return {
    programmeName: r!.programme_name,
    seats: r!.seats, barSeats: r!.bar_seats, tradingHours: r!.trading_hours, serverFiguresMinRole: r!.server_figures_min_role,
    gainAreas: r!.gain_areas, scorecardEmails: r!.scorecard_emails, dataVersion: r!.data_version,
  };
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function saveSettings(sql: Db, venueId: string, input: Omit<GrowthSettings, "dataVersion"> & { siteName?: string }): Promise<void> {
  const programmeName = String(input.programmeName ?? "").trim().slice(0, 60);
  if (!programmeName) throw new Error("Give the programme a name.");
  const siteName = input.siteName == null ? null : String(input.siteName).trim().slice(0, 120);
  if (siteName === "") throw new Error("Give the site a name.");
  if (!Number.isInteger(input.seats) || input.seats < 1 || input.seats > 2000) throw new Error("Seats must be a whole number, 1 or more.");
  if (input.barSeats != null && (!Number.isInteger(input.barSeats) || input.barSeats < 0)) throw new Error("Bar seats must be a whole number.");
  const hours: GrowthSettings["tradingHours"] = {};
  for (const d of DAY_KEYS) {
    const h = input.tradingHours[d];
    if (h && !(HHMM.test(h[0]) && HHMM.test(h[1]))) throw new Error(`Trading hours for ${d} must be times like 17:00.`);
    hours[d] = h ? [h[0], h[1]] : null;
  }
  if (!["owner", "manager", "host"].includes(input.serverFiguresMinRole)) throw new Error("Unknown role.");
  const areas = input.gainAreas.map((a) => ({ name: a.name.trim().slice(0, 60), captain: a.captain.trim().slice(0, 60) })).filter((a) => a.name);
  if (!areas.length) throw new Error("Keep at least one gain area.");
  const emails = input.scorecardEmails.map((e) => e.trim().toLowerCase()).filter(Boolean);
  const bad = emails.find((e) => !EMAIL.test(e));
  if (bad) throw new Error(`${bad} is not an email address.`);
  await getSettings(sql, venueId);
  // Seats change RevPASH, which is computed on read, so cached models stay valid.
  if (siteName) await sql`update venues set name = ${siteName} where id = ${venueId}`;
  await sql`update growth_settings set programme_name = ${programmeName}, seats = ${input.seats}, bar_seats = ${input.barSeats}, trading_hours = ${JSON.stringify(hours)}::text::jsonb,
            server_figures_min_role = ${input.serverFiguresMinRole}, gain_areas = ${JSON.stringify(areas)}::text::jsonb,
            scorecard_emails = ${emails}, updated_at = now() where venue_id = ${venueId}`;
}

// --- the model -------------------------------------------------------------

const cache = ((globalThis as unknown as { growthModels?: Map<string, { version: number; model: Model | null }> }).growthModels ??= new Map());

/** Everything loaded for the venue, as the engine's model. Cached until the next import. */
export async function loadModel(sql: Db, venueId: string): Promise<Model | null> {
  const { dataVersion } = await getSettings(sql, venueId);
  const hit = cache.get(venueId);
  if (hit && hit.version === dataVersion) return hit.model;
  const [checks, items, bookings] = await Promise.all([
    sql`select check_id as id, (extract(epoch from opened_at) * 1000)::float8 as open, (extract(epoch from closed_at) * 1000)::float8 as close,
               table_ref as "table", covers::float8 as covers, server, net_total::float8 as net
        from growth_checks where venue_id = ${venueId} order by opened_at, check_id`,
    sql`select check_id as "check", item, category as cat, item_group as "group", qty::float8 as qty, net_price::float8 as net, unit_cost::float8 as cost
        from growth_items where venue_id = ${venueId} order by check_id, line_no`,
    sql`select booking_id as id, (extract(epoch from booked_for) * 1000)::float8 as at, party_size::float8 as size, status, channel, lead_days as lead
        from growth_bookings where venue_id = ${venueId} order by booked_for, booking_id`,
  ]);
  const model = checks.length
    ? build({
        checks: checks.map((c) => ({ ...c, net: c.net ?? NaN })) as unknown as CheckRow[],
        items: items as unknown as ItemRow[],
        bookings: bookings as unknown as BookingRow[],
      })
    : null;
  cache.set(venueId, { version: dataVersion, model });
  return model;
}

async function bump(sql: Db, venueId: string) {
  await sql`update growth_settings set data_version = data_version + 1 where venue_id = ${venueId}`;
  cache.delete(venueId);
}

/** Summary and heatmap figures from the stored daily and hourly summaries, without the raw rows. */
export async function loadStored(sql: Db, venueId: string): Promise<{ source: Source; days: DayRow[]; hours: HourRow[] } | null> {
  const { seats } = await getSettings(sql, venueId);
  const [days, hours, cost] = await Promise.all([
    sql`select (trading_day - ${EPOCH}::date) as day, sales, covers, checks, item_covers as "itemCovers", item_sales as "itemSales",
               drink_qty as "drinkQty", drink_sales as "drinkSales", food_sales as "foodSales", starters, desserts, cost,
               dur_sum as "durSum", dur_n as "durN", late_sales as "lateSales",
               bookings_seated as seated, bookings_no_show as "noShow", bookings_cancelled as cancelled
        from growth_metric_day where venue_id = ${venueId} order by trading_day`,
    sql`select (trading_day - ${EPOCH}::date) as day, trading_hour as hour, sales, cover_hours as "coverHours"
        from growth_metric_hour where venue_id = ${venueId} order by trading_day, trading_hour`,
    sql`select exists (select 1 from growth_items where venue_id = ${venueId} and unit_cost > 0) as has`,
  ]);
  if (!days.some((d) => d.checks > 0)) return null;
  const d = days as unknown as DayRow[];
  const h = hours as unknown as HourRow[];
  return { source: storedSource(d, h, cost[0]!.has, seats), days: d, hours: h };
}

/** Rewrite the stored summaries for a range of trading days from the raw rows. */
export async function refreshSummaries(sql: Sql, venueId: string, from: number, to: number): Promise<void> {
  await bump(sql, venueId);
  const m = await loadModel(sql, venueId);
  const days = m ? dayRows(m, from, to) : [];
  const hours = m ? hourRows(m, from, to) : [];
  await sql.begin(async (tx) => {
    await tx`delete from growth_metric_day where venue_id = ${venueId} and trading_day between ${isoDay(from)}::date and ${isoDay(to)}::date`;
    await tx`delete from growth_metric_hour where venue_id = ${venueId} and trading_day between ${isoDay(from)}::date and ${isoDay(to)}::date`;
    if (days.length)
      await tx`insert into growth_metric_day
        select ${venueId}::uuid, ${EPOCH}::date + x.day, x.sales, x.covers, x.checks, x."itemCovers", x."itemSales", x."drinkQty", x."drinkSales", x."foodSales",
               x.starters, x.desserts, x.cost, x."durSum", x."durN", x."lateSales", x.seated, x."noShow", x.cancelled
        from jsonb_to_recordset(${JSON.stringify(days)}::text::jsonb) as x(day int, sales float8, covers float8, checks int, "itemCovers" float8, "itemSales" float8,
          "drinkQty" float8, "drinkSales" float8, "foodSales" float8, starters float8, desserts float8, cost float8, "durSum" float8, "durN" int,
          "lateSales" float8, seated int, "noShow" int, cancelled int)`;
    if (hours.length)
      await tx`insert into growth_metric_hour
        select ${venueId}::uuid, ${EPOCH}::date + x.day, x.hour, x.sales, x."coverHours"
        from jsonb_to_recordset(${JSON.stringify(hours)}::text::jsonb) as x(day int, hour int, sales float8, "coverHours" float8)`;
  });
}

// --- import ----------------------------------------------------------------

export interface ImportReport {
  headers: string[];
  mapping: Record<string, string | null>;
  /** Count of skipped rows by reason. */
  reasons: Record<string, number>;
  /** The first few skipped rows, with their line number in the file. */
  examples: { row: number; reason: string }[];
}
export interface ImportRecord {
  id: string;
  kind: FileKind;
  filename: string;
  status: "loading" | "loaded" | "failed";
  rowsRead: number;
  rowsLoaded: number;
  rowsNew: number;
  rowsSkipped: number;
  firstDay: string | null;
  lastDay: string | null;
  report: ImportReport;
  sample: boolean;
  createdAt: Date;
}
const IMPORT_COLS = `id, kind, filename, status, rows_read as "rowsRead", rows_loaded as "rowsLoaded", greatest(rows_new, 0) as "rowsNew",
  rows_skipped as "rowsSkipped", first_day::text as "firstDay", last_day::text as "lastDay", report, sample, created_at as "createdAt"`;

export async function listImports(sql: Db, venueId: string, limit = 50): Promise<ImportRecord[]> {
  return sql<ImportRecord[]>`select ${sql.unsafe(IMPORT_COLS)} from growth_imports where venue_id = ${venueId} order by created_at desc, kind limit ${limit}`;
}
export async function getImport(sql: Db, venueId: string, id: string): Promise<ImportRecord | null> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const [r] = await sql<ImportRecord[]>`select ${sql.unsafe(IMPORT_COLS)} from growth_imports where venue_id = ${venueId} and id = ${id}`;
  return r ?? null;
}

export async function savedMappings(sql: Db, venueId: string): Promise<Partial<Record<FileKind, Record<string, string | null>>>> {
  const rows = await sql`select kind, mapping from growth_column_maps where venue_id = ${venueId}`;
  return Object.fromEntries(rows.map((r) => [r.kind, r.mapping]));
}

const isKind = (k: unknown): k is FileKind => k === "checks" || k === "items" || k === "bookings";

/** Open an import: checks the mapping covers the required fields and saves it for next time. */
export async function startImport(
  sql: Db,
  venueId: string,
  input: { kind: FileKind; filename: string; headers: string[]; mapping: Record<string, string | null>; sample?: boolean },
): Promise<string> {
  if (!isKind(input.kind)) throw new Error("Unknown file type.");
  const headers = input.headers.map((h) => String(h).trim()).slice(0, 200);
  const mapping: Record<string, string | null> = {};
  for (const f of FIELDS[input.kind]) {
    const h = input.mapping[f.field] ?? null;
    if (h != null && !headers.includes(h)) throw new Error(`The file has no column called "${h}".`);
    if (f.required && h == null) throw new Error(`Choose which column holds ${f.field}. The ${input.kind} file cannot load without it.`);
    mapping[f.field] = h;
  }
  if (input.kind !== "checks") {
    const [c] = await sql`select 1 from growth_checks where venue_id = ${venueId} limit 1`;
    if (!c && input.kind === "items") throw new Error("Load the checks file first: item lines are matched to their check.");
  }
  await getSettings(sql, venueId);
  await sql`insert into growth_column_maps (venue_id, kind, mapping) values (${venueId}, ${input.kind}, ${JSON.stringify(mapping)}::text::jsonb)
            on conflict (venue_id, kind) do update set mapping = excluded.mapping, updated_at = now()`;
  const report: ImportReport = { headers, mapping, reasons: {}, examples: [] };
  const [r] = await sql`insert into growth_imports (venue_id, kind, filename, sample, report)
                        values (${venueId}, ${input.kind}, ${input.filename.slice(0, 200)}, ${!!input.sample}, ${JSON.stringify(report)}::text::jsonb) returning id`;
  return r!.id;
}

const stamp = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace("T", " ");
const money = (v: number) => Math.round(v * 100) / 100;
const MAX_MONEY = 99_999_999;
const YEAR_MIN = Date.UTC(2000, 0, 1);
const YEAR_MAX = Date.UTC(2100, 0, 1);
const okTime = (ms: number) => ms >= YEAR_MIN && ms < YEAR_MAX;

/**
 * Load the next piece of a file: CSV text without the header line. Rows are
 * validated by the engine's parsers and upserted on their natural keys, so
 * loading the same file again replaces rows and never duplicates them.
 */
export async function importChunk(sql: Sql, venueId: string, importId: string, text: string): Promise<{ rowsRead: number; rowsSkipped: number }> {
  const cells = csvCells(text);
  return sql.begin(async (tx) => {
    const [imp] = await tx`select kind, status, rows_read, report from growth_imports where id = ${importId} and venue_id = ${venueId} for update`;
    if (!imp) throw new Error("That import no longer exists. Start again.");
    if (imp.status !== "loading") throw new Error("That import has already finished.");
    const kind = imp.kind as FileKind;
    const report = imp.report as ImportReport;
    const base = imp.rows_read as number;
    let skipped = 0;
    const skip = (i: number, reason: string) => {
      skipped++;
      report.reasons[reason] = (report.reasons[reason] ?? 0) + 1;
      if (report.examples.length < 25) report.examples.push({ row: base + i + 2, reason });
    };
    const parsed = <T,>(parse: (row: Record<string, unknown>, i: number) => Parsed<T>): { i: number; row: T }[] => {
      const out: { i: number; row: T }[] = [];
      cells.forEach((line, i) => {
        const p = parse(applyMap(toRow(report.headers, line), report.mapping), base + i);
        if (p.ok) out.push({ i, row: p.row });
        else skip(i, p.reason);
      });
      return out;
    };
    let loaded = 0;
    let fresh = 0;
    let first: number | null = null;
    let last: number | null = null;
    const span = (day: number) => {
      if (first == null || day < first) first = day;
      if (last == null || day > last) last = day;
    };

    if (kind === "checks") {
      const byId = new Map<string, unknown>();
      for (const { i, row: c } of parsed(parseCheck)) {
        if (!okTime(c.open)) skip(i, "opened_at is outside 2000 to 2100");
        else if (c.close != null && !okTime(c.close)) skip(i, "closed_at is outside 2000 to 2100");
        else if (c.covers > 9999) skip(i, "covers is too large");
        else if (!isNaN(c.net) && Math.abs(c.net) > MAX_MONEY) skip(i, "net_total is too large");
        else {
          if (byId.has(c.id)) skip(i, "Same check_id appears twice: the later row was kept");
          const day = bizDay(c.open);
          span(day);
          byId.set(c.id, { id: c.id.slice(0, 120), open: stamp(c.open), close: c.close == null ? null : stamp(c.close), day: isoDay(day), tbl: c.table.slice(0, 60),
            covers: Math.round(c.covers * 100) / 100, server: c.server.slice(0, 80), net: isNaN(c.net) ? null : money(c.net) });
        }
      }
      const rows = [...byId.values()];
      if (rows.length) {
        const res = await tx`
          insert into growth_checks (venue_id, check_id, opened_at, closed_at, trading_day, table_ref, covers, server, net_total, import_id)
          select ${venueId}::uuid, x.id, x.open, x.close, x.day, x.tbl, x.covers, x.server, x.net, ${importId}::uuid
          from jsonb_to_recordset(${JSON.stringify(rows)}::text::jsonb) as x(id text, open timestamp, close timestamp, day date, tbl text, covers numeric, server text, net numeric)
          on conflict (venue_id, check_id) do update set opened_at = excluded.opened_at, closed_at = excluded.closed_at, trading_day = excluded.trading_day,
            table_ref = excluded.table_ref, covers = excluded.covers, server = excluded.server, net_total = excluded.net_total, import_id = excluded.import_id
          returning (xmax = 0) as fresh`;
        loaded = res.length;
        fresh = res.filter((r) => r.fresh).length;
      }
    } else if (kind === "items") {
      const lines = parsed(parseItem).filter(({ i, row }) => (Math.abs(row.net) > MAX_MONEY || row.cost > MAX_MONEY || row.qty > 999_999 ? (skip(i, "A number on the line is too large"), false) : true));
      const ids = [...new Set(lines.map((l) => l.row.check))];
      const known = new Map<string, string>();
      if (ids.length)
        for (const r of await tx`select check_id, trading_day::text as day from growth_checks where venue_id = ${venueId} and check_id = any(${ids})`) known.set(r.check_id, r.day);
      // Lines from an earlier upload of these checks are replaced.
      const gone = ids.length ? await tx`delete from growth_items where venue_id = ${venueId} and check_id = any(${ids}) and import_id is distinct from ${importId}` : { count: 0 };
      const next = new Map<string, number>();
      if (ids.length)
        for (const r of await tx`select check_id, max(line_no) as n from growth_items where venue_id = ${venueId} and check_id = any(${ids}) group by 1`) next.set(r.check_id, r.n);
      const rows: unknown[] = [];
      for (const { i, row: it } of lines) {
        const day = known.get(it.check);
        if (!day) {
          skip(i, "Its check is not in the checks file");
          continue;
        }
        span(Math.floor(Date.parse(day) / DAY));
        const n = (next.get(it.check) ?? 0) + 1;
        next.set(it.check, n);
        rows.push({ id: it.check, n, item: it.item.slice(0, 200), cat: it.cat.slice(0, 80), grp: it.group, qty: Math.round(it.qty * 100) / 100, net: money(it.net), cost: money(it.cost) });
      }
      if (rows.length)
        await tx`insert into growth_items (venue_id, check_id, line_no, item, category, item_group, qty, net_price, unit_cost, import_id)
                 select ${venueId}::uuid, x.id, x.n, x.item, x.cat, x.grp, x.qty, x.net, x.cost, ${importId}::uuid
                 from jsonb_to_recordset(${JSON.stringify(rows)}::text::jsonb) as x(id text, n int, item text, cat text, grp text, qty numeric, net numeric, cost numeric)`;
      loaded = rows.length;
      fresh = rows.length - gone.count;
    } else {
      const byId = new Map<string, unknown>();
      for (const { i, row: b } of parsed(parseBooking)) {
        if (!okTime(b.at)) skip(i, "booked_for is outside 2000 to 2100");
        else if (b.size > 9999 || b.size <= 0) skip(i, "party_size is not a usable number");
        else {
          if (byId.has(b.id)) skip(i, "Same booking_id appears twice: the later row was kept");
          const day = bizDay(b.at);
          span(day);
          byId.set(b.id, { id: b.id.slice(0, 120), at: stamp(b.at), day: isoDay(day), size: b.size, status: b.status, channel: b.channel.slice(0, 80), lead: b.lead == null ? null : Math.min(b.lead, 100_000) });
        }
      }
      const rows = [...byId.values()];
      if (rows.length) {
        const res = await tx`
          insert into growth_bookings (venue_id, booking_id, booked_for, trading_day, party_size, status, channel, lead_days, import_id)
          select ${venueId}::uuid, x.id, x.at, x.day, x.size, x.status, x.channel, x.lead, ${importId}::uuid
          from jsonb_to_recordset(${JSON.stringify(rows)}::text::jsonb) as x(id text, at timestamp, day date, size numeric, status text, channel text, lead int)
          on conflict (venue_id, booking_id) do update set booked_for = excluded.booked_for, trading_day = excluded.trading_day, party_size = excluded.party_size,
            status = excluded.status, channel = excluded.channel, lead_days = excluded.lead_days, import_id = excluded.import_id
          returning (xmax = 0) as fresh`;
        loaded = res.length;
        fresh = res.filter((r) => r.fresh).length;
      }
    }
    // A duplicate id is reported as skipped but its replacement did load.
    const [u] = await tx`
      update growth_imports set rows_read = rows_read + ${cells.length}, rows_loaded = rows_loaded + ${loaded}, rows_new = rows_new + ${fresh},
        rows_skipped = rows_skipped + ${skipped}, report = ${JSON.stringify(report)}::text::jsonb,
        first_day = least(first_day, ${first == null ? null : isoDay(first)}::date), last_day = greatest(last_day, ${last == null ? null : isoDay(last)}::date)
      where id = ${importId} returning rows_read, rows_skipped`;
    return { rowsRead: u!.rows_read, rowsSkipped: u!.rows_skipped };
  });
}

/** Close an import and rewrite the stored summaries for the days it touched. */
export async function finishImport(sql: Sql, venueId: string, importId: string, opts: { failed?: string } = {}): Promise<ImportRecord> {
  const [imp] = await sql`
    update growth_imports set status = ${opts.failed ? "failed" : "loaded"}, finished_at = now(),
      report = report || ${JSON.stringify(opts.failed ? { error: opts.failed } : {})}::text::jsonb
    where id = ${importId} and venue_id = ${venueId} and status = 'loading'
    returning (first_day - ${EPOCH}::date) as first, (last_day - ${EPOCH}::date) as last`;
  if (!imp) throw new Error("That import has already finished.");
  if (imp.first != null) await refreshSummaries(sql, venueId, imp.first, imp.last);
  else await bump(sql, venueId);
  return (await getImport(sql, venueId, importId))!;
}

/** Remove the venue's loaded data and summaries. Ideas, tests and gains are kept. */
export async function clearData(sql: Sql, venueId: string): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`delete from growth_checks where venue_id = ${venueId}`;
    await tx`delete from growth_bookings where venue_id = ${venueId}`;
    await tx`delete from growth_metric_day where venue_id = ${venueId}`;
    await tx`delete from growth_metric_hour where venue_id = ${venueId}`;
    await tx`delete from growth_imports where venue_id = ${venueId}`;
  });
  await bump(sql, venueId);
}

/** Load a whole file in one go (the sample data, tests). The browser sends large files in pieces instead. */
export async function importFile(sql: Sql, venueId: string, kind: FileKind, filename: string, text: string, opts: { sample?: boolean; mapping?: Record<string, string | null> } = {}): Promise<ImportRecord> {
  const nl = text.indexOf("\n");
  const { headers } = csvRows(nl < 0 ? text : text.slice(0, nl));
  const saved = (await savedMappings(sql, venueId))[kind];
  const id = await startImport(sql, venueId, { kind, filename, headers, mapping: opts.mapping ?? autoMap(kind, headers, saved), sample: opts.sample });
  try {
    await importChunk(sql, venueId, id, nl < 0 ? "" : text.slice(nl + 1));
  } catch (err) {
    await finishImport(sql, venueId, id, { failed: (err as Error).message });
    throw err;
  }
  return finishImport(sql, venueId, id);
}

/** The invented 60-seat sample: 26 weeks of checks, items and bookings. */
export async function loadSample(sql: Sql, venueId: string): Promise<void> {
  const dir = path.join(process.cwd(), "fixtures", "growth", "sample");
  await clearData(sql, venueId);
  for (const kind of ["checks", "items", "bookings"] as const)
    await importFile(sql, venueId, kind, `sample-${kind}.csv`, await readFile(path.join(dir, `${kind}.csv`), "utf8"), { sample: true });
}

/** What is loaded, for the page header. */
export async function dataStatus(sql: Db, venueId: string): Promise<{ checks: number; items: number; bookings: number; sample: boolean; firstDay: string | null; lastDay: string | null }> {
  const [r] = await sql`
    select (select count(*)::int from growth_checks where venue_id = ${venueId}) as checks,
           (select count(*)::int from growth_items where venue_id = ${venueId}) as items,
           (select count(*)::int from growth_bookings where venue_id = ${venueId}) as bookings,
           (select min(trading_day)::text from growth_checks where venue_id = ${venueId}) as "firstDay",
           (select max(trading_day)::text from growth_checks where venue_id = ${venueId}) as "lastDay",
           coalesce((select bool_and(sample) from growth_imports where venue_id = ${venueId} and status = 'loaded'), false) as sample`;
  return r as never;
}
