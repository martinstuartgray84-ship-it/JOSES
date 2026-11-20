// The programme on top of the metrics: periods, scoreboard tiles, attention
// flags, test readouts, gain values, the weekly scorecard, events and the bridge.

import { METRICS, dayparts, menu, parties, servers, summarise, summary, type Fmt, type Heat, type MetricKey, type Model, type ModelCheck, type Source, type Summary } from "./model";
import { fmtDay, weekOf } from "./time";

// --- formatting ------------------------------------------------------------

const nf = (v: number, d: number) => v.toLocaleString("en-GB", { minimumFractionDigits: d, maximumFractionDigits: d });
const F: Record<Fmt, (v: number) => string> = {
  money0: (v) => "£" + nf(v, 0),
  money2: (v) => "£" + nf(v, 2),
  dec1: (v) => nf(v, 1),
  dec2: (v) => nf(v, 2),
  int: (v) => nf(v, 0),
  pct1: (v) => nf(v * 100, 1) + "%",
  pct0: (v) => nf(v * 100, 0) + "%",
};
export const fmt = (kind: Fmt, v: number | null | undefined): string => (v == null || isNaN(v) ? "No data" : F[kind](v));
export const moneyK = (v: number): string => (Math.abs(v) >= 1e6 ? "£" + nf(v / 1e6, 2) + "m" : "£" + nf(v / 1000, 0) + "k");
export const pctChange = (ch: number | null): string => (ch == null ? "No data" : (ch > 0 ? "+" : "") + nf(ch * 100, 1) + "%");

// --- periods ---------------------------------------------------------------

export interface Period {
  from: number;
  to: number;
  /** The period of equal length just before, when the data reaches that far back. */
  prior: { from: number; to: number } | null;
  label: string;
}
/** The last `weeks` weeks of data (0 = everything), ending on the last trading day loaded. */
export function period(src: { minDay: number; maxDay: number }, weeks: number): Period {
  const first = weekOf(src.minDay);
  const to = src.maxDay;
  const span = weeks ? weeks * 7 : to - first + 1;
  const from = Math.max(first, to - span + 1);
  const pTo = from - 1;
  const pFrom = pTo - (to - from);
  return { from, to, prior: weeks && pFrom >= first ? { from: pFrom, to: pTo } : null, label: `${fmtDay(from)} to ${fmtDay(to)}` };
}

// --- scoreboard tiles ------------------------------------------------------

export interface Tile {
  key: string;
  label: string;
  fmt: Fmt;
  better: 1 | -1;
  value: number | null;
  prior: number | null;
  /** Change on the prior period as a fraction, or null. */
  change: number | null;
}
const TILE_DEFS: { key: string; label: string; fmt: Fmt; better: 1 | -1; get: (s: Summary, h: Heat) => number | null }[] = [
  { key: "salesPerWeek", label: "Net sales per week", fmt: "money0", better: 1, get: (s) => s.salesPerWeek },
  { key: "coversPerWeek", label: "Covers per week", fmt: "int", better: 1, get: (s) => s.coversPerWeek },
  { key: "sph", label: "Spend per head", fmt: "money2", better: 1, get: (s) => s.sph },
  { key: "dpc", label: "Drinks per cover", fmt: "dec2", better: 1, get: (s) => s.dpc },
  { key: "turn", label: "Turn time, minutes", fmt: "dec1", better: -1, get: (s) => s.turn },
  { key: "peakFriSat", label: "RevPASH, Fri and Sat 7 to 9pm", fmt: "money2", better: 1, get: (_, h) => h.peakFriSat },
  { key: "lateShare", label: "Sales after 10pm", fmt: "pct1", better: 1, get: (s) => s.lateShare },
  { key: "noShow", label: "No-show rate", fmt: "pct1", better: -1, get: (s) => s.noShow },
  { key: "gp", label: "Gross margin", fmt: "pct1", better: 1, get: (s) => s.gp },
];
const change = (now: number | null, prev: number | null): number | null => (now == null || prev == null || !prev ? null : (now - prev) / Math.abs(prev));

/** The nine scoreboard tiles for a period, each against the prior period when there is one. */
export function tiles(src: Source, p: { from: number; to: number; prior: { from: number; to: number } | null }): Tile[] {
  const s = src.summary(p.from, p.to);
  const h = src.heat(p.from, p.to);
  const ps = p.prior ? src.summary(p.prior.from, p.prior.to) : null;
  const ph = p.prior ? src.heat(p.prior.from, p.prior.to) : null;
  return TILE_DEFS.map((t) => {
    const value = s.checks ? t.get(s, h) : null;
    const prior = ps && ph && ps.checks ? t.get(ps, ph) : null;
    return { key: t.key, label: t.label, fmt: t.fmt, better: t.better, value, prior, change: change(value, prior) };
  });
}

// --- what needs attention --------------------------------------------------

export interface Flag {
  level: "hot" | "ok" | "";
  text: string;
}
export function attention(m: Model, from: number, to: number, h: Heat): Flag[] {
  const flags: Flag[] = [];
  const s = summary(m, from, to);
  const sv = servers(m, from, to);
  if (h.peakFriSat && h.lateFriSat != null)
    flags.push({ level: h.lateFriSat < h.peakFriSat * 0.5 ? "hot" : "ok", text: `Friday and Saturday seats earn ${fmt("money2", h.lateFriSat)} an hour from 10pm to midnight, against ${fmt("money2", h.peakFriSat)} from 7 to 9pm. The late slot is the largest unsold asset.` });
  if (sv.list.length > 1) {
    const top = sv.list[0]!;
    const low = sv.list[sv.list.length - 1]!;
    flags.push({ level: "", text: `Spend per head runs from ${fmt("money2", low.sph)} (${low.server}) to ${fmt("money2", top.sph)} (${top.server}). Lifting everyone below the median to the median is worth ${fmt("money0", sv.gapPerWeek)} a week.` });
  }
  if (m.hasItems) {
    const list = menu(m, from, to);
    const dogs = list.filter((o) => o.cls === "Dog");
    const puzzles = list.filter((o) => o.cls === "Puzzle");
    if (list.length) flags.push({ level: "", text: `${dogs.length} menu items are low on both popularity and margin, and ${puzzles.length} earn well but sell little${puzzles[0] ? `, led by ${puzzles[0].item}` : ""}. See Menu.` });
  }
  const twos = parties(m, from, to)[1]!;
  if (twos.share != null) flags.push({ level: "", text: `${fmt("pct0", twos.share)} of checks are parties of two. Compare that with the share of your tables that seat two.` });
  if (s.noShow != null) flags.push({ level: s.noShow > 0.03 ? "hot" : "ok", text: `No-shows are ${fmt("pct1", s.noShow)} of bookings. Card guarantees on peak slots usually take this below 2%.` });
  if (s.drinkShare != null && s.coversPerWeek != null) {
    const price = avgDrinkPrice(m, from, to) ?? 9.5;
    flags.push({ level: s.drinkShare < 0.4 ? "hot" : "ok", text: `Drinks are ${fmt("pct0", s.drinkShare)} of sales at ${fmt("dec2", s.dpc)} per cover. Each extra 0.1 drinks per cover is worth about ${fmt("money0", 0.1 * s.coversPerWeek * price)} a week at a ${fmt("money2", price)} average.` });
  }
  return flags;
}

export function avgDrinkPrice(m: Model, from: number, to: number): number | null {
  let q = 0;
  let v = 0;
  for (const it of m.items) if (it.group === "drink" && it.day >= from && it.day <= to) { q += it.qty; v += it.net; }
  return q ? v / q : null;
}

// --- tests -----------------------------------------------------------------

export type Design = "before_after" | "alternate_weeks" | "split_section";
export const DESIGNS: Record<Design, { label: string; help: string }> = {
  before_after: { label: "Before and after", help: "Six weeks before the start against the test period. Cannot separate the change from season or weather." },
  alternate_weeks: { label: "Alternate weeks", help: "On in the first week, off in the second, and so on. On-weeks are compared with off-weeks." },
  split_section: { label: "Split by section", help: "On at some tables, off at the rest, over the same dates." },
};
export interface TestSpec {
  metric: MetricKey;
  guardrail: MetricKey | null;
  design: Design;
  startDay: number;
  endDay: number | null;
  passMarkPct: number;
  /** Tables in the test group, for a split-by-section design. */
  tables?: string[];
}
export interface Read {
  key: MetricKey;
  /** Baseline, off-weeks or the rest of the room. */
  control: number | null;
  /** Test period, on-weeks or the test tables. */
  test: number | null;
  change: number | null;
}
export type Verdict = "not_started" | "no_baseline" | "too_early" | "wrong_direction" | "below_pass_mark" | "passed";
export interface Readout {
  primary: Read;
  guardrail: Read | null;
  /** True when the guardrail moved the wrong way by more than GUARDRAIL_TOLERANCE. */
  guardrailBreached: boolean;
  verdict: Verdict;
  /** Weeks of test data read so far. */
  weeks: number;
  controlLabel: string;
  testLabel: string;
}
export const GUARDRAIL_TOLERANCE = 0.02;
export const VERDICTS: Record<Verdict, { label: string; tone: "good" | "bad" | "warn" | "" }> = {
  not_started: { label: "Not started in this data", tone: "" },
  no_baseline: { label: "Nothing to compare with", tone: "" },
  too_early: { label: "Too early to call", tone: "" },
  wrong_direction: { label: "Wrong direction", tone: "bad" },
  below_pass_mark: { label: "Moving, below pass mark", tone: "warn" },
  passed: { label: "Pass mark met", tone: "good" },
};

export function readout(m: Model, t: TestSpec): Readout {
  const last = t.endDay != null ? Math.min(t.endDay, m.maxDay) : m.maxDay;
  const labels: Record<Design, [string, string]> = {
    before_after: ["Six weeks before", "Test period"],
    alternate_weeks: ["Off-weeks", "On-weeks"],
    split_section: ["Other tables", "Test tables"],
  };
  const [controlLabel, testLabel] = labels[t.design];
  const empty = (key: MetricKey): Read => ({ key, control: null, test: null, change: null });
  const base = { controlLabel, testLabel, guardrailBreached: false };
  if (!m.checks.length || t.startDay > last)
    return { ...base, primary: empty(t.metric), guardrail: t.guardrail ? empty(t.guardrail) : null, verdict: "not_started", weeks: 0 };

  let control: Summary | null = null;
  let test: Summary;
  if (t.design === "alternate_weeks") {
    const on = (d: number) => d >= t.startDay && d <= last && Math.floor((d - t.startDay) / 7) % 2 === 0;
    const off = (d: number) => d >= t.startDay && d <= last && Math.floor((d - t.startDay) / 7) % 2 === 1;
    let nOn = 0;
    let nOff = 0;
    for (let d = t.startDay; d <= last; d++) (on(d) ? nOn++ : nOff++);
    test = summarise(m, on, nOn);
    if (nOff) control = summarise(m, off, nOff);
  } else if (t.design === "split_section") {
    const set = new Set((t.tables ?? []).map((x) => x.trim().toLowerCase()).filter(Boolean));
    const inRange = (d: number) => d >= t.startDay && d <= last;
    const inTest = (c: ModelCheck) => set.has(c.table.trim().toLowerCase());
    test = summarise(m, inRange, last - t.startDay + 1, inTest);
    if (set.size) control = summarise(m, inRange, last - t.startDay + 1, (c) => !inTest(c));
  } else {
    const b0 = Math.max(m.minDay, t.startDay - 42);
    const b1 = t.startDay - 1;
    test = summary(m, t.startDay, last);
    if (b1 >= b0) control = summary(m, b0, b1);
  }

  const read = (key: MetricKey): Read => {
    const c = control ? control[key] : null;
    const v = test[key];
    return { key, control: c, test: v, change: c && v != null ? (v - c) / c : null };
  };
  const primary = read(t.metric);
  const guardrail = t.guardrail ? read(t.guardrail) : null;
  const guardrailBreached = !!guardrail && guardrail.change != null && guardrail.change * METRICS[guardrail.key].better < -GUARDRAIL_TOLERANCE;
  const weeks = (last - t.startDay + 1) / 7;
  let verdict: Verdict;
  if (primary.change == null) verdict = "no_baseline";
  else if (weeks < 2) verdict = "too_early";
  else if (primary.change * METRICS[t.metric].better <= 0) verdict = "wrong_direction";
  else if (Math.abs(primary.change * 100) >= Math.abs(t.passMarkPct)) verdict = "passed";
  else verdict = "below_pass_mark";
  return { ...base, primary, guardrail, guardrailBreached, verdict, weeks };
}

/**
 * A first estimate of what a measured change is worth in net sales over a
 * year, for metrics where that is a straight multiplication. Null for the
 * rest: the manager enters a figure. Uses the last 12 weeks for volumes.
 */
export function yearlyValue(m: Model, r: Read): number | null {
  if (r.control == null || r.test == null || !m.checks.length) return null;
  const delta = r.test - r.control;
  const p = period(m, 12);
  const s = summary(m, p.from, p.to);
  const cpw = s.coversPerWeek ?? 0;
  switch (r.key) {
    case "salesPerWeek":
    case "lateSalesPerWeek":
      return delta * 52;
    case "sph":
      return delta * cpw * 52;
    case "dpc": {
      const price = avgDrinkPrice(m, p.from, p.to);
      return price == null ? null : delta * cpw * 52 * price;
    }
    case "coversPerWeek":
      return s.sph == null ? null : delta * s.sph * 52;
    default:
      return null;
  }
}

/** Limits the method asks the app to warn on. */
export function liveTestWarnings(live: { name: string; metric: string }[]): string[] {
  const out: string[] = [];
  if (live.length > 4) out.push(`${live.length} tests are live. The method keeps it to three or four so each result can be read.`);
  const by = new Map<string, string[]>();
  for (const t of live) by.set(t.metric, [...(by.get(t.metric) ?? []), t.name]);
  for (const [k, names] of by)
    if (names.length > 1) out.push(`${names.length} live tests share the same primary metric (${METRICS[k as MetricKey]?.label ?? k}): ${names.join(", ")}. Their effects cannot be told apart.`);
  return out;
}

// --- weekly scorecard ------------------------------------------------------

export interface ScoreTile {
  key: string;
  label: string;
  fmt: Fmt;
  better: 1 | -1;
  value: number | null;
  priorWeek: number | null;
  /** The four weeks before, taken together. */
  fourWeek: number | null;
  onPriorWeek: number | null;
  onFourWeek: number | null;
}
export interface Scorecard {
  week: number;
  label: string;
  tiles: ScoreTile[];
}
/** The nine tiles for the trading week starting Monday `week`. */
export function scorecard(src: Source, week: number): Scorecard {
  const now = tiles(src, { from: week, to: week + 6, prior: { from: week - 7, to: week - 1 } });
  const four = tiles(src, { from: week - 28, to: week - 1, prior: null });
  return {
    week,
    label: `${fmtDay(week)} to ${fmtDay(week + 6)}`,
    tiles: now.map((t, i) => ({
      key: t.key, label: t.label, fmt: t.fmt, better: t.better, value: t.value,
      priorWeek: t.prior, fourWeek: four[i]!.value, onPriorWeek: t.change, onFourWeek: change(t.value, four[i]!.value),
    })),
  };
}

// --- events ----------------------------------------------------------------

export interface EventMoney {
  revenue: number;
  costOfGoods: number;
  extraLabour: number;
  directCosts: number;
  /** Normal net sales the event pushed out. */
  displacedSales: number;
  /** Share of displaced sales that would have been contribution, 0 to 1. */
  contributionRate: number;
}
/** Net gain = revenue − cost of goods − extra labour − direct costs − displaced sales × contribution rate. */
export const eventNetGain = (e: EventMoney): number => e.revenue - e.costOfGoods - e.extraLabour - e.directCosts - e.displacedSales * e.contributionRate;

export const SLOTS = [
  { key: "lunch", label: "Lunch and afternoon, to 5pm", lo: 5, hi: 17 },
  { key: "dinner", label: "Dinner, 5pm to 10pm", lo: 17, hi: 22 },
  { key: "late", label: "Late, from 10pm", lo: 22, hi: 30 },
  { key: "all", label: "Whole day", lo: 5, hi: 30 },
] as const;
export interface MinSpendCell {
  /** Normal net sales for the whole room in that slot on that weekday. */
  normal: number;
  minimum: number;
}
/**
 * Minimum spend to take the whole room: normal net sales for each weekday
 * and slot, from the heatmap, × (1 + premium). Null where the room does not trade.
 */
export function minSpendGrid(h: Heat, seats: number, premium: number): (MinSpendCell | null)[][] {
  return h.grid.map((row) =>
    SLOTS.map((slot) => {
      if (!row.days) return null;
      let normal = 0;
      for (let hr = Math.max(slot.lo, h.hmin); hr < slot.hi && hr <= h.hmax; hr++) normal += (row.cells[hr - h.hmin]?.rev ?? 0) * seats;
      return normal > 0 ? { normal, minimum: normal * (1 + premium) } : null;
    }),
  );
}

// --- bridge ----------------------------------------------------------------

export const BRIDGE_FIELDS = [
  ["sph", "Spend per head uplift, %", 25], ["cov", "Peak covers uplift, %", 15],
  ["lateN", "Late nights a year", 150], ["lateG", "Guests per late night", 100], ["lateS", "Late spend per guest, £", 25],
  ["brN", "Brunch days a year", 100], ["brC", "Brunch covers a day", 70], ["brS", "Brunch spend per head, £", 40],
  ["early", "Early week and lunch, £ a year", 120000], ["hire", "Private hire and groups, £ a year", 150000], ["off", "Off-premise, £ a year", 100000],
] as const;
export type BridgeKey = (typeof BRIDGE_FIELDS)[number][0];
export type BridgeInput = Record<BridgeKey, number> & { base: number; target: number };
export const bridgeDefaults = (base: number): BridgeInput => ({ ...(Object.fromEntries(BRIDGE_FIELDS.map((f) => [f[0], f[2]])) as Record<BridgeKey, number>), base, target: 3 });
/** Annual base figure from a weekly run-rate, rounded to the nearest £1,000. */
export const annualBase = (salesPerWeek: number | null): number => Math.round(((salesPerWeek ?? 0) * 52) / 1000) * 1000;

export interface Bridge {
  /** First step is today's base; the rest are what each move adds. */
  steps: { label: string; adds: number; running: number }[];
  total: number;
  multiple: number | null;
  /** Positive: still to find. Negative: above the target line. */
  gap: number;
  targetLine: number;
}
export function bridge(b: BridgeInput): Bridge {
  const steps: Bridge["steps"] = [{ label: "Today", adds: b.base, running: b.base }];
  let run = b.base;
  const step = (label: string, adds: number) => {
    run += adds;
    steps.push({ label, adds, running: run });
  };
  step("Spend per guest", (b.base * b.sph) / 100);
  step("Peak capacity", ((b.base + (b.base * b.sph) / 100) * b.cov) / 100);
  step("Late night", b.lateN * b.lateG * b.lateS);
  step("Brunch", b.brN * b.brC * b.brS);
  step("Early week", b.early);
  step("Hire and groups", b.hire);
  step("Off-premise", b.off);
  const targetLine = b.base * b.target;
  return { steps, total: run, multiple: b.base ? run / b.base : null, gap: targetLine - run, targetLine };
}


