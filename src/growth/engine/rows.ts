// Import: rows from the three CSV files to the engine's internal shape.
// See docs/growth/DATA_CONTRACT.md. Headers are matched case-insensitively
// after trimming and replacing spaces and hyphens with underscores.

import { DAY, parseTime } from "./time";

export type FileKind = "checks" | "items" | "bookings";
export type RawRow = Record<string, unknown>;

export interface CheckRow {
  id: string;
  open: number;
  close: number | null;
  table: string;
  covers: number;
  server: string;
  /** NaN when the file has no net total: the model sums the item lines instead. */
  net: number;
}
export interface ItemRow {
  check: string;
  item: string;
  cat: string;
  group: "food" | "drink";
  qty: number;
  /** Line total, not unit price. */
  net: number;
  /** Recipe cost of one unit. */
  cost: number;
}
export type BookingStatus = "seated" | "no_show" | "cancelled";
export interface BookingRow {
  id: string;
  at: number;
  size: number;
  status: BookingStatus;
  channel: string;
  lead: number | null;
}
export interface GrowthData {
  checks: CheckRow[];
  items: ItemRow[];
  bookings: BookingRow[];
}

export interface FieldSpec {
  field: string;
  aliases: string[];
  required: boolean;
  note: string;
}

/** Canonical fields and the header names accepted for each, in priority order. */
export const FIELDS: Record<FileKind, FieldSpec[]> = {
  checks: [
    { field: "check_id", aliases: ["check", "id", "order_id"], required: true, note: "Bill number" },
    { field: "opened_at", aliases: ["opened", "open", "opened_time", "date"], required: true, note: "When the bill was opened" },
    { field: "closed_at", aliases: ["closed", "close", "paid_at"], required: false, note: "Needed for turn time" },
    { field: "table", aliases: ["table_no"], required: false, note: "Table" },
    { field: "covers", aliases: ["guests", "pax", "party_size"], required: false, note: "Guests on the bill; 1 if missing" },
    { field: "server", aliases: ["waiter", "staff", "employee"], required: false, note: "Who served" },
    { field: "net_total", aliases: ["net", "total", "net_sales"], required: false, note: "Net of VAT and service charge" },
  ],
  items: [
    { field: "check_id", aliases: ["check", "order_id"], required: true, note: "Bill number" },
    { field: "item", aliases: ["name", "product"], required: true, note: "Item name" },
    { field: "category", aliases: ["cat"], required: false, note: "Menu category" },
    { field: "group", aliases: ["type"], required: false, note: "Food or drink, if the till says" },
    { field: "qty", aliases: ["quantity"], required: false, note: "Quantity; 1 if missing" },
    { field: "net_price", aliases: ["net", "line_total", "total"], required: false, note: "Line total, not unit price" },
    { field: "unit_cost", aliases: ["cost"], required: false, note: "Recipe cost of one" },
  ],
  bookings: [
    { field: "booking_id", aliases: ["id"], required: false, note: "Booking reference" },
    { field: "booked_for", aliases: ["datetime", "date", "reservation_time"], required: true, note: "Date and time booked for" },
    { field: "party_size", aliases: ["covers", "guests"], required: false, note: "Guests; 2 if missing" },
    { field: "status", aliases: [], required: false, note: "Seated, no-show or cancelled" },
    { field: "channel", aliases: ["source"], required: false, note: "Where the booking came from" },
    { field: "created_at", aliases: ["booked_at"], required: false, note: "When it was made, for lead time" },
  ],
};

export const normHeader = (h: unknown): string => String(h).trim().toLowerCase().replace(/[\s-]+/g, "_");

/** For each canonical field, the file header that feeds it (or null). A header is used once. */
export function autoMap(kind: FileKind, headers: string[], saved?: Record<string, string | null>): Record<string, string | null> {
  const byNorm = new Map<string, string>();
  for (const h of headers) if (!byNorm.has(normHeader(h))) byNorm.set(normHeader(h), h);
  const out: Record<string, string | null> = {};
  const used = new Set<string>();
  for (const f of FIELDS[kind]) {
    let hit: string | null = null;
    const prior = saved?.[f.field];
    if (prior && headers.includes(prior) && !used.has(prior)) hit = prior;
    for (const name of [f.field, ...f.aliases]) {
      if (hit) break;
      const h = byNorm.get(name);
      if (h && !used.has(h)) hit = h;
    }
    if (hit) used.add(hit);
    out[f.field] = hit;
  }
  return out;
}

/** Rename a row's columns to canonical field names using a mapping from autoMap or the user. */
export function applyMap(row: RawRow, mapping: Record<string, string | null>): RawRow {
  const out: RawRow = {};
  for (const [field, header] of Object.entries(mapping)) if (header != null) out[field] = row[header];
  return out;
}

function col(row: RawRow, names: string[]): unknown {
  for (const n of names) if (row[n] != null && row[n] !== "") return row[n];
  return null;
}
const names = (kind: FileKind, field: string): string[] => {
  const f = FIELDS[kind].find((x) => x.field === field)!;
  return [f.field, ...f.aliases];
};
export function num(v: unknown): number {
  if (v == null) return NaN;
  return parseFloat(String(v).replace(/[£$€,\s]/g, ""));
}
function lower(row: RawRow): RawRow {
  const o: RawRow = {};
  for (const k of Object.keys(row)) o[normHeader(k)] = row[k];
  return o;
}

export const DRINK = /cocktail|beer|wine|spirit|soft|drink|tequila|mezcal|marg|bar|beverage/i;
export const STARTER = /starter|appeti|small|botana/i;
export const DESSERT = /dessert|postre|sweet/i;

export type Parsed<T> = { ok: true; row: T } | { ok: false; reason: string };

export function parseCheck(raw: RawRow): Parsed<CheckRow> {
  const r = lower(raw);
  const id = col(r, names("checks", "check_id"));
  const open = parseTime(col(r, names("checks", "opened_at")));
  if (id == null) return { ok: false, reason: "No check_id" };
  if (isNaN(open)) return { ok: false, reason: "opened_at missing or not a date (use YYYY-MM-DD HH:MM)" };
  const close = parseTime(col(r, names("checks", "closed_at")));
  const cov = num(col(r, names("checks", "covers")));
  return {
    ok: true,
    row: {
      id: String(id),
      open,
      close: isNaN(close) ? null : close,
      table: String(col(r, names("checks", "table")) || ""),
      covers: cov > 0 ? cov : 1,
      server: String(col(r, names("checks", "server")) || "Unknown"),
      net: num(col(r, names("checks", "net_total"))),
    },
  };
}

export function parseItem(raw: RawRow): Parsed<ItemRow> {
  const r = lower(raw);
  const id = col(r, names("items", "check_id"));
  const name = col(r, names("items", "item"));
  if (id == null) return { ok: false, reason: "No check_id" };
  if (name == null) return { ok: false, reason: "No item name" };
  const cat = String(col(r, names("items", "category")) || "Other");
  const grp = col(r, names("items", "group"));
  let qty = num(col(r, names("items", "qty")));
  if (!(qty > 0)) qty = 1;
  const cost = num(col(r, names("items", "unit_cost")));
  return {
    ok: true,
    row: {
      check: String(id),
      item: String(name),
      cat,
      group: grp ? (DRINK.test(String(grp)) ? "drink" : "food") : DRINK.test(cat) ? "drink" : "food",
      qty,
      net: num(col(r, names("items", "net_price"))) || 0,
      cost: isNaN(cost) ? 0 : cost,
    },
  };
}

/** `index` is the row's position in the file, used as the key when there is no booking_id. */
export function parseBooking(raw: RawRow, index: number): Parsed<BookingRow> {
  const r = lower(raw);
  const at = parseTime(col(r, names("bookings", "booked_for")));
  if (isNaN(at)) return { ok: false, reason: "booked_for missing or not a date" };
  const st = String(col(r, ["status"]) || "seated").toLowerCase().replace(/[\s-]+/g, "_");
  const created = parseTime(col(r, names("bookings", "created_at")));
  return {
    ok: true,
    row: {
      id: String(col(r, names("bookings", "booking_id")) || index),
      at,
      size: num(col(r, names("bookings", "party_size"))) || 2,
      status: /no/.test(st) ? "no_show" : /cancel/.test(st) ? "cancelled" : "seated",
      channel: String(col(r, names("bookings", "channel")) || "Unknown"),
      lead: isNaN(created) ? null : Math.max(0, Math.round((at - created) / DAY)),
    },
  };
}

/** Whole-file conversion. Reports the first five problems, as the prototype did. */
export function fromRows(raw: { checks?: RawRow[]; items?: RawRow[]; bookings?: RawRow[] }): { data: GrowthData; errors: string[] } {
  const errors: string[] = [];
  const note = (msg: string) => {
    if (errors.length < 5) errors.push(msg);
  };
  const data: GrowthData = { checks: [], items: [], bookings: [] };
  (raw.checks ?? []).forEach((r, i) => {
    const p = parseCheck(r);
    if (p.ok) data.checks.push(p.row);
    else note(`Checks row ${i + 2}: ${p.reason}.`);
  });
  (raw.items ?? []).forEach((r, i) => {
    const p = parseItem(r);
    if (p.ok) data.items.push(p.row);
    else note(`Items row ${i + 2}: ${p.reason}.`);
  });
  (raw.bookings ?? []).forEach((r, i) => {
    const p = parseBooking(r, i);
    if (p.ok) data.bookings.push(p.row);
    else note(`Bookings row ${i + 2}: ${p.reason}.`);
  });
  if (!data.checks.length) errors.unshift("No usable rows in the checks file. It is the one file the console cannot work without.");
  return { data, errors };
}
