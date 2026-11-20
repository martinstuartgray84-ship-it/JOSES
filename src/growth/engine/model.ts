// The model and every metric. Pure functions, no I/O. Definitions are in
// docs/growth/DEFINITIONS.md; if this file and that one disagree, the doc wins.

import type { BookingStatus, GrowthData } from "./rows";
import { DESSERT, STARTER } from "./rows";
import { MIN, bizDay, bizHour, dow, fmtDay, weekOf } from "./time";

export interface ModelCheck {
  id: string;
  open: number;
  close: number | null;
  table: string;
  covers: number;
  server: string;
  net: number;
  day: number;
  hour: number;
  /** Minutes open to close, or null without a usable close time. */
  dur: number | null;
  drinkQty: number;
  drinkSales: number;
  foodSales: number;
  starters: number;
  desserts: number;
  cost: number;
  hasItems: boolean;
}
export interface ModelItem {
  day: number;
  item: string;
  cat: string;
  group: "food" | "drink";
  qty: number;
  net: number;
  /** Recipe cost of the whole line. */
  cost: number;
}
export interface ModelBooking {
  day: number;
  size: number;
  status: BookingStatus;
  channel: string;
  lead: number | null;
}
export interface Model {
  checks: ModelCheck[];
  items: ModelItem[];
  bookings: ModelBooking[];
  hasItems: boolean;
  hasCost: boolean;
  hasBookings: boolean;
  minDay: number;
  maxDay: number;
}

export function build(data: GrowthData): Model {
  const byId = new Map<string, ModelCheck>();
  let hasCost = false;
  let minDay = Infinity;
  let maxDay = -Infinity;
  const checks = data.checks.map((c) => {
    const o: ModelCheck = {
      id: c.id, open: c.open, close: c.close, table: c.table, covers: c.covers, server: c.server, net: c.net,
      day: bizDay(c.open), hour: bizHour(c.open),
      dur: c.close && c.close > c.open ? (c.close - c.open) / MIN : null,
      drinkQty: 0, drinkSales: 0, foodSales: 0, starters: 0, desserts: 0, cost: 0, hasItems: false,
    };
    byId.set(c.id, o);
    if (o.day < minDay) minDay = o.day;
    if (o.day > maxDay) maxDay = o.day;
    return o;
  });
  const items: ModelItem[] = [];
  for (const it of data.items) {
    const c = byId.get(it.check);
    if (!c) continue;
    c.hasItems = true;
    if (it.group === "drink") {
      c.drinkQty += it.qty;
      c.drinkSales += it.net;
    } else c.foodSales += it.net;
    if (STARTER.test(it.cat)) c.starters += it.qty;
    if (DESSERT.test(it.cat)) c.desserts += it.qty;
    if (it.cost > 0) hasCost = true;
    c.cost += it.cost * it.qty;
    items.push({ day: c.day, item: it.item, cat: it.cat, group: it.group, qty: it.qty, net: it.net, cost: it.cost * it.qty });
  }
  for (const c of checks) if (c.net == null || isNaN(c.net)) c.net = c.foodSales + c.drinkSales;
  const bookings = data.bookings.map((b) => ({ day: bizDay(b.at), size: b.size, status: b.status, channel: b.channel, lead: b.lead }));
  return { checks, items, bookings, hasItems: items.length > 0, hasCost, hasBookings: bookings.length > 0, minDay, maxDay };
}

export const div = (a: number, b: number): number | null => (b ? a / b : null);

export interface Summary {
  sales: number;
  covers: number;
  checks: number;
  weeks: number;
  salesPerWeek: number | null;
  coversPerWeek: number | null;
  sph: number | null;
  dpc: number | null;
  drinkShare: number | null;
  starterAttach: number | null;
  dessertAttach: number | null;
  turn: number | null;
  gp: number | null;
  lateShare: number | null;
  lateSalesPerWeek: number | null;
  noShow: number | null;
  bookings: number;
  cancelRate: number | null;
}

/** The additive parts behind a Summary: one row of these per trading day is what gets stored. */
export interface Totals {
  sales: number; covers: number; checks: number;
  itemCovers: number; itemSales: number;
  drinkQty: number; drinkSales: number; foodSales: number;
  starters: number; desserts: number; cost: number;
  durSum: number; durN: number; lateSales: number;
  seated: number; noShow: number; cancelled: number;
}
export const zeroTotals = (): Totals => ({
  sales: 0, covers: 0, checks: 0, itemCovers: 0, itemSales: 0, drinkQty: 0, drinkSales: 0, foodSales: 0,
  starters: 0, desserts: 0, cost: 0, durSum: 0, durN: 0, lateSales: 0, seated: 0, noShow: 0, cancelled: 0,
});
function addCheck(s: Totals, c: ModelCheck) {
  s.sales += c.net; s.covers += c.covers; s.checks++;
  if (c.hasItems) {
    s.itemCovers += c.covers; s.itemSales += c.foodSales + c.drinkSales; s.drinkQty += c.drinkQty; s.drinkSales += c.drinkSales;
    s.foodSales += c.foodSales; s.starters += c.starters; s.desserts += c.desserts; s.cost += c.cost;
  }
  if (c.dur != null) { s.durSum += c.dur; s.durN++; }
  if (c.hour >= 22) s.lateSales += c.net;
}
function addBooking(s: Totals, b: ModelBooking) {
  if (b.status === "no_show") s.noShow++;
  else if (b.status === "cancelled") s.cancelled++;
  else s.seated++;
}
export function addTotals(a: Totals, b: Totals): Totals {
  for (const k of Object.keys(a) as (keyof Totals)[]) a[k] += b[k];
  return a;
}

/** Turn additive totals over `nDays` days into the headline ratios. */
export function finish(s: Totals, nDays: number, hasCost: boolean): Summary {
  const weeks = nDays / 7;
  const bookings = s.seated + s.noShow + s.cancelled;
  return {
    sales: s.sales, covers: s.covers, checks: s.checks, weeks,
    salesPerWeek: div(s.sales, weeks), coversPerWeek: div(s.covers, weeks),
    sph: div(s.sales, s.covers), dpc: div(s.drinkQty, s.itemCovers), drinkShare: div(s.drinkSales, s.itemSales),
    starterAttach: div(s.starters, s.itemCovers), dessertAttach: div(s.desserts, s.itemCovers),
    turn: div(s.durSum, s.durN), gp: hasCost ? div(s.itemSales - s.cost, s.itemSales) : null,
    lateShare: div(s.lateSales, s.sales), lateSalesPerWeek: div(s.lateSales, weeks),
    noShow: div(s.noShow, s.noShow + s.seated), bookings, cancelRate: div(s.cancelled, bookings),
  };
}

/**
 * Summary over any set of days. `checkIn` narrows to some checks (a section of
 * the room); bookings cannot be split that way, so booking figures are left out.
 */
export function summarise(m: Model, dayIn: (day: number) => boolean, nDays: number, checkIn?: (c: ModelCheck) => boolean): Summary {
  const s = zeroTotals();
  for (const c of m.checks) if (dayIn(c.day) && (!checkIn || checkIn(c))) addCheck(s, c);
  if (!checkIn) for (const b of m.bookings) if (dayIn(b.day)) addBooking(s, b);
  return finish(s, nDays, m.hasCost);
}

export const summary = (m: Model, from: number, to: number): Summary => summarise(m, (d) => d >= from && d <= to, to - from + 1);

export interface WeekRow extends Summary {
  week: number;
  label: string;
}
export function weekly(m: Model): WeekRow[] {
  const out: WeekRow[] = [];
  if (!m.checks.length) return out;
  for (let w = weekOf(m.minDay); w <= weekOf(m.maxDay); w += 7) {
    const s = summary(m, w, w + 6);
    out.push({ ...s, week: w, label: fmtDay(w), weeks: 1, salesPerWeek: s.sales, coversPerWeek: s.covers, lateSalesPerWeek: s.lateShare != null ? s.lateShare * s.sales : null });
  }
  return out;
}

export interface HeatCell {
  /** RevPASH: net sales per available seat-hour. */
  rev: number;
  /** Seat occupancy, capped at 1.5. */
  occ: number;
}
export interface Heat {
  /** One row per day of week, Monday first. `days` is how many dates of that weekday traded. */
  grid: { days: number; cells: (HeatCell | null)[] }[];
  hmin: number;
  hmax: number;
  peak: number;
  /** Mean RevPASH, Friday and Saturday 19:00 to 21:00. */
  peakFriSat: number | null;
  /** Mean RevPASH, Friday and Saturday 22:00 to 24:00. */
  lateFriSat: number | null;
}

/** One check spread across the clock hours it occupied, in proportion to time in each. */
function spread(c: ModelCheck, each: (hour: number, sales: number, coverHours: number) => void) {
  const dur = c.dur != null ? c.dur / 60 : 1.5;
  const h0 = c.hour;
  const h1 = c.hour + dur;
  for (let h = Math.floor(h0); h < h1 && h < 30; h++) {
    const frac = Math.min(h1, h + 1) - Math.max(h0, h);
    each(h, (c.net * frac) / dur, c.covers * frac);
  }
}

/** Shared by the model path and the stored-summary path, so both give the same heatmap. */
function heatFrom(sales: Map<string, number>, occ: Map<string, number>, dayCounts: number[], seats: number): Heat {
  let hmin = 29;
  let hmax = 5;
  for (const k of sales.keys()) {
    const h = +k.split(":")[1]!;
    if (h < hmin) hmin = h;
    if (h > hmax) hmax = h;
  }
  const grid: Heat["grid"] = [];
  let peak = 0;
  for (let d = 0; d < 7; d++) {
    const n = dayCounts[d]!;
    const cells: (HeatCell | null)[] = [];
    for (let h = hmin; h <= hmax; h++) {
      const k = `${d}:${h}`;
      const s = sales.get(k);
      const v = n && s ? { rev: s / (seats * n), occ: Math.min(1.5, (occ.get(k) ?? 0) / (seats * n)) } : null;
      if (v && v.rev > peak) peak = v.rev;
      cells.push(v);
    }
    grid.push({ days: n, cells });
  }
  const avg = (dows: number[], h0: number, h1: number) => {
    let t = 0;
    let c = 0;
    for (const d of dows)
      for (let h = h0; h < h1; h++) {
        if (grid[d]!.days && h >= hmin && h <= hmax) {
          t += grid[d]!.cells[h - hmin]?.rev ?? 0;
          c++;
        }
      }
    return c ? t / c : null;
  };
  return { grid, hmin, hmax, peak, peakFriSat: avg([4, 5], 19, 21), lateFriSat: avg([4, 5], 22, 24) };
}

/** Revenue per available seat-hour and seat occupancy, by day of week and hour. */
export function heat(m: Model, from: number, to: number, seats: number): Heat {
  const sales = new Map<string, number>();
  const occ = new Map<string, number>();
  const days: Set<number>[] = Array.from({ length: 7 }, () => new Set<number>());
  for (const c of m.checks) {
    if (c.day < from || c.day > to) continue;
    const d = dow(c.day);
    days[d]!.add(c.day);
    spread(c, (h, s, ch) => {
      const k = `${d}:${h}`;
      sales.set(k, (sales.get(k) ?? 0) + s);
      occ.set(k, (occ.get(k) ?? 0) + ch);
    });
  }
  return heatFrom(sales, occ, days.map((s) => s.size), seats);
}

export type MenuClass = "Star" | "Plough horse" | "Puzzle" | "Dog";
export interface MenuRow {
  item: string;
  cat: string;
  group: "food" | "drink";
  qty: number;
  sales: number;
  cost: number;
  price: number;
  /** Contribution per sale. */
  margin: number;
  contribution: number;
  share: number;
  cls: MenuClass;
  /** Popularity threshold for the item's group. */
  thr: number;
  /** Margin benchmark for the item's group. */
  avgMargin: number;
}

/** Menu engineering: popularity against contribution per sale, within food and within drink. */
export function menu(m: Model, from: number, to: number): MenuRow[] {
  const map = new Map<string, MenuRow>();
  for (const it of m.items) {
    if (it.day < from || it.day > to) continue;
    let o = map.get(it.item);
    if (!o) {
      o = { item: it.item, cat: it.cat, group: it.group, qty: 0, sales: 0, cost: 0, price: 0, margin: 0, contribution: 0, share: 0, cls: "Dog", thr: 0, avgMargin: 0 };
      map.set(it.item, o);
    }
    o.qty += it.qty;
    o.sales += it.net;
    o.cost += it.cost;
  }
  const list = [...map.values()];
  for (const g of ["food", "drink"] as const) {
    const grp = list.filter((o) => o.group === g);
    let q = 0;
    let cm = 0;
    for (const o of grp) {
      q += o.qty;
      cm += o.sales - o.cost;
    }
    const thr = grp.length ? (0.7 * q) / grp.length : 0;
    const avgM = q ? cm / q : 0;
    for (const o of grp) {
      o.price = o.sales / o.qty;
      o.margin = (o.sales - o.cost) / o.qty;
      o.contribution = o.sales - o.cost;
      o.share = q ? o.qty / q : 0;
      const pop = o.qty >= thr;
      const rich = o.margin >= avgM;
      o.cls = pop && rich ? "Star" : pop ? "Plough horse" : rich ? "Puzzle" : "Dog";
      o.thr = thr;
      o.avgMargin = avgM;
    }
  }
  return list.sort((a, b) => b.contribution - a.contribution);
}

export interface ServerRow {
  server: string;
  sales: number;
  covers: number;
  checks: number;
  sph: number | null;
  dpc: number | null;
  starter: number | null;
  dessert: number | null;
}
export interface Servers {
  list: ServerRow[];
  median: number;
  /** Weekly prize from lifting everyone below the median to the median. */
  gapPerWeek: number;
}
export function servers(m: Model, from: number, to: number): Servers {
  const map = new Map<string, { server: string; sales: number; covers: number; checks: number; drinkQty: number; starters: number; desserts: number; itemCovers: number }>();
  for (const c of m.checks) {
    if (c.day < from || c.day > to) continue;
    let o = map.get(c.server);
    if (!o) {
      o = { server: c.server, sales: 0, covers: 0, checks: 0, drinkQty: 0, starters: 0, desserts: 0, itemCovers: 0 };
      map.set(c.server, o);
    }
    o.sales += c.net; o.covers += c.covers; o.checks++;
    if (c.hasItems) { o.drinkQty += c.drinkQty; o.starters += c.starters; o.desserts += c.desserts; o.itemCovers += c.covers; }
  }
  const list: ServerRow[] = [...map.values()].map((o) => ({
    server: o.server, sales: o.sales, covers: o.covers, checks: o.checks,
    sph: div(o.sales, o.covers), dpc: div(o.drinkQty, o.itemCovers), starter: div(o.starters, o.itemCovers), dessert: div(o.desserts, o.itemCovers),
  }));
  list.sort((a, b) => (b.sph ?? 0) - (a.sph ?? 0));
  const sorted = list.map((o) => o.sph ?? 0).sort((a, b) => a - b);
  const median = sorted.length ? (sorted[Math.floor((sorted.length - 1) / 2)]! + sorted[Math.ceil((sorted.length - 1) / 2)]!) / 2 : 0;
  let gap = 0;
  for (const o of list) if ((o.sph ?? 0) < median) gap += (median - (o.sph ?? 0)) * o.covers;
  return { list, median, gapPerWeek: gap / ((to - from + 1) / 7) };
}

export interface PartyRow {
  label: string;
  checks: number;
  covers: number;
  sales: number;
  share: number | null;
  turn: number | null;
  sph: number | null;
}
export function parties(m: Model, from: number, to: number): PartyRow[] {
  const bands = ([["1", 1, 1], ["2", 2, 2], ["3 to 4", 3, 4], ["5 to 6", 5, 6], ["7 or more", 7, 99]] as const).map(([label, lo, hi]) => ({ label, lo, hi, checks: 0, covers: 0, sales: 0, dur: 0, durN: 0 }));
  let total = 0;
  for (const c of m.checks) {
    if (c.day < from || c.day > to) continue;
    const b = bands.find((x) => c.covers >= x.lo && c.covers <= x.hi);
    if (b) {
      b.checks++; b.covers += c.covers; b.sales += c.net;
      if (c.dur != null) { b.dur += c.dur; b.durN++; }
    }
    total++;
  }
  return bands.map((b) => ({ label: b.label, checks: b.checks, covers: b.covers, sales: b.sales, share: div(b.checks, total), turn: div(b.dur, b.durN), sph: div(b.sales, b.covers) }));
}

export interface DaypartRow {
  label: string;
  sales: number;
  covers: number;
  share: number | null;
  sph: number | null;
  drinkShare: number | null;
}
export function dayparts(m: Model, from: number, to: number): DaypartRow[] {
  const parts = [{ label: "Lunch and afternoon", lo: 5, hi: 17 }, { label: "Dinner", lo: 17, hi: 22 }, { label: "Late, from 10pm", lo: 22, hi: 30 }].map((p) => ({ ...p, sales: 0, covers: 0, drink: 0, item: 0 }));
  let total = 0;
  for (const c of m.checks) {
    if (c.day < from || c.day > to) continue;
    for (const p of parts)
      if (c.hour >= p.lo && c.hour < p.hi) { p.sales += c.net; p.covers += c.covers; p.drink += c.drinkSales; p.item += c.drinkSales + c.foodSales; }
    total += c.net;
  }
  return parts.map((p) => ({ label: p.label, sales: p.sales, covers: p.covers, share: div(p.sales, total), sph: div(p.sales, p.covers), drinkShare: div(p.drink, p.item) }));
}

export interface ChannelRow {
  channel: string;
  total: number;
  seated: number;
  noShow: number;
  cancelled: number;
  /** Covers on seated bookings. */
  covers: number;
  noShowRate: number | null;
  /** Mean lead time in days. */
  avgLead: number | null;
}
export function channels(m: Model, from: number, to: number): ChannelRow[] {
  const map = new Map<string, ChannelRow & { lead: number; leadN: number }>();
  for (const b of m.bookings) {
    if (b.day < from || b.day > to) continue;
    let o = map.get(b.channel);
    if (!o) {
      o = { channel: b.channel, total: 0, seated: 0, noShow: 0, cancelled: 0, covers: 0, noShowRate: null, avgLead: null, lead: 0, leadN: 0 };
      map.set(b.channel, o);
    }
    o.total++;
    if (b.status === "no_show") o.noShow++;
    else if (b.status === "cancelled") o.cancelled++;
    else { o.seated++; o.covers += b.size; }
    if (b.lead != null) { o.lead += b.lead; o.leadN++; }
  }
  return [...map.values()]
    .map(({ lead, leadN, ...o }) => ({ ...o, noShowRate: div(o.noShow, o.noShow + o.seated), avgLead: div(lead, leadN) }))
    .sort((a, b) => b.total - a.total);
}

export type Fmt = "money0" | "money2" | "dec1" | "dec2" | "int" | "pct1" | "pct0";
export type MetricKey = "sph" | "dpc" | "salesPerWeek" | "coversPerWeek" | "turn" | "noShow" | "lateSalesPerWeek" | "starterAttach" | "dessertAttach" | "drinkShare" | "gp";

/** Metrics a test can be judged on. `better` is 1 when higher is better, -1 when lower is. */
export const METRICS: Record<MetricKey, { label: string; fmt: Fmt; better: 1 | -1 }> = {
  sph: { label: "Spend per head", fmt: "money2", better: 1 },
  dpc: { label: "Drinks per cover", fmt: "dec2", better: 1 },
  salesPerWeek: { label: "Net sales per week", fmt: "money0", better: 1 },
  coversPerWeek: { label: "Covers per week", fmt: "int", better: 1 },
  turn: { label: "Turn time, minutes", fmt: "dec1", better: -1 },
  noShow: { label: "No-show rate", fmt: "pct1", better: -1 },
  lateSalesPerWeek: { label: "Sales after 10pm per week", fmt: "money0", better: 1 },
  starterAttach: { label: "Starters per cover", fmt: "dec2", better: 1 },
  dessertAttach: { label: "Desserts per cover", fmt: "dec2", better: 1 },
  drinkShare: { label: "Drinks share of sales", fmt: "pct1", better: 1 },
  gp: { label: "Gross margin", fmt: "pct1", better: 1 },
};
export const isMetric = (k: unknown): k is MetricKey => typeof k === "string" && k in METRICS;

export interface BeforeAfter {
  before: number | null;
  after: number | null;
  change: number | null;
  weeksAfter: number;
}
/**
 * Baseline = up to `baselineWeeks` (six) weeks before the start, not earlier
 * than the first data. After = start to `endDay`, or to the last data.
 */
export function beforeAfter(m: Model, key: MetricKey, startDay: number, baselineWeeks = 6, endDay?: number | null): BeforeAfter {
  const b0 = Math.max(m.minDay, startDay - baselineWeeks * 7);
  const b1 = startDay - 1;
  const last = endDay != null ? Math.min(endDay, m.maxDay) : m.maxDay;
  if (startDay > last || b1 < b0) return { before: null, after: null, change: null, weeksAfter: 0 };
  const before = summary(m, b0, b1)[key];
  const after = summary(m, startDay, last)[key];
  return { before, after, change: before && after != null ? (after - before) / before : null, weeksAfter: (last - startDay + 1) / 7 };
}

// ---------------------------------------------------------------------------
// Stored summaries: what gets written after each import, and how to read
// the same figures back without the raw rows.

export interface DayRow extends Totals {
  day: number;
}
export interface HourRow {
  day: number;
  hour: number;
  sales: number;
  coverHours: number;
}

export function dayRows(m: Model, from = -Infinity, to = Infinity): DayRow[] {
  const map = new Map<number, DayRow>();
  const at = (day: number) => {
    let r = map.get(day);
    if (!r) map.set(day, (r = { day, ...zeroTotals() }));
    return r;
  };
  for (const c of m.checks) if (c.day >= from && c.day <= to) addCheck(at(c.day), c);
  for (const b of m.bookings) if (b.day >= from && b.day <= to) addBooking(at(b.day), b);
  return [...map.values()].sort((a, b) => a.day - b.day);
}

export function hourRows(m: Model, from = -Infinity, to = Infinity): HourRow[] {
  const map = new Map<string, HourRow>();
  for (const c of m.checks) {
    if (c.day < from || c.day > to) continue;
    spread(c, (hour, sales, coverHours) => {
      const k = `${c.day}:${hour}`;
      const r = map.get(k);
      if (r) { r.sales += sales; r.coverHours += coverHours; }
      else map.set(k, { day: c.day, hour, sales, coverHours });
    });
  }
  return [...map.values()].sort((a, b) => a.day - b.day || a.hour - b.hour);
}

export function summaryFromDays(days: DayRow[], hasCost: boolean, from: number, to: number): Summary {
  const s = zeroTotals();
  for (const d of days) if (d.day >= from && d.day <= to) addTotals(s, d);
  return finish(s, to - from + 1, hasCost);
}

export function heatFromStored(hours: HourRow[], days: DayRow[], from: number, to: number, seats: number): Heat {
  const sales = new Map<string, number>();
  const occ = new Map<string, number>();
  const counts = [0, 0, 0, 0, 0, 0, 0];
  for (const d of days) if (d.day >= from && d.day <= to && d.checks > 0) counts[dow(d.day)]!++;
  for (const h of hours) {
    if (h.day < from || h.day > to) continue;
    const k = `${dow(h.day)}:${h.hour}`;
    sales.set(k, (sales.get(k) ?? 0) + h.sales);
    occ.set(k, (occ.get(k) ?? 0) + h.coverHours);
  }
  return heatFrom(sales, occ, counts, seats);
}

/** Where summary and heatmap figures come from: the full model, or the stored summaries. */
export interface Source {
  minDay: number;
  maxDay: number;
  summary(from: number, to: number): Summary;
  heat(from: number, to: number): Heat;
}
export const modelSource = (m: Model, seats: number): Source => ({
  minDay: m.minDay, maxDay: m.maxDay,
  summary: (from, to) => summary(m, from, to),
  heat: (from, to) => heat(m, from, to, seats),
});
export function storedSource(days: DayRow[], hours: HourRow[], hasCost: boolean, seats: number): Source {
  const traded = days.filter((d) => d.checks > 0);
  return {
    minDay: traded.length ? traded[0]!.day : Infinity,
    maxDay: traded.length ? traded[traded.length - 1]!.day : -Infinity,
    summary: (from, to) => summaryFromDays(days, hasCost, from, to),
    heat: (from, to) => heatFromStored(hours, days, from, to, seats),
  };
}
