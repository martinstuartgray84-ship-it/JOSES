import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { csvRows } from "../csv";
import {
  FIELDS, attention, autoMap, applyMap, beforeAfter, bizDay, bizHour, bridge, bridgeDefaults, build, channels, dayFromIso, dayRows, dayparts, dow,
  eventNetGain, fromRows, heat, heatFromStored, hourRows, isoDay, liveTestWarnings, menu, minSpendGrid, modelSource, parseTime, parties, period,
  readout, scorecard, servers, storedSource, summary, summaryFromDays, tiles, weekOf, weekly, yearlyValue, type Model,
} from "./index";

const dir = path.join(__dirname, "../../../fixtures/growth");
const load = (name: string) => csvRows(readFileSync(path.join(dir, "sample", `${name}.csv`), "utf8")).rows;
const golden = JSON.parse(readFileSync(path.join(dir, "golden.json"), "utf8"));
const TOL = 0.0001;

/** Every number in `want` must be matched within the tolerance; strings and nulls exactly. */
function close(got: unknown, want: unknown, at: string) {
  if (typeof want === "number") {
    expect(typeof got, at).toBe("number");
    expect(Math.abs((got as number) - want), `${at}: got ${got}, want ${want}`).toBeLessThanOrEqual(TOL);
  } else if (Array.isArray(want)) {
    expect(Array.isArray(got), at).toBe(true);
    expect((got as unknown[]).length, `${at}.length`).toBe(want.length);
    want.forEach((w, i) => close((got as unknown[])[i], w, `${at}[${i}]`));
  } else if (want && typeof want === "object") {
    for (const [k, w] of Object.entries(want)) close((got as Record<string, unknown>)[k], w, `${at}.${k}`);
  } else expect(got, at).toEqual(want);
}

let m: Model;
const seats = 60;
const from = dayFromIso(golden.range.from);
const to = dayFromIso(golden.range.to);
const pFrom = dayFromIso(golden.range.priorFrom);
const pTo = dayFromIso(golden.range.priorTo);

describe("golden: sample CSVs through fromRows and build", () => {
  it("loads every row with no errors", () => {
    const r = fromRows({ checks: load("checks"), items: load("items"), bookings: load("bookings") });
    expect(r.errors).toEqual([]);
    m = build(r.data);
    expect({ checks: m.checks.length, items: m.items.length, bookings: m.bookings.length }).toEqual(golden.counts);
    expect(isoDay(m.minDay)).toBe(golden.range.minDay);
    expect(isoDay(m.maxDay)).toBe(golden.range.maxDay);
  });
  it("headline for the last 12 weeks", () => {
    const s = summary(m, from, to);
    expect(s.salesPerWeek).toBeCloseTo(17454.83, 2);
    expect(s.sph).toBeCloseTo(32.8871, 4);
    expect(s.dpc).toBeCloseTo(1.604, 3);
  });
  it("summary and prior", () => {
    close(summary(m, from, to), golden.summary, "summary");
    close(summary(m, pFrom, pTo), golden.prior, "prior");
  });
  it("weekly", () => close(weekly(m).map((w) => ({ ...w, week: isoDay(w.week) })), golden.weekly, "weekly"));
  it("heat", () => {
    const h = heat(m, from, to, seats);
    close({ ...h, grid: h.grid.map((g) => ({ days: g.days, rev: g.cells.map((c) => c?.rev ?? null), occ: g.cells.map((c) => c?.occ ?? null) })) }, golden.heat, "heat");
  });
  it("menu", () => close(menu(m, from, to), golden.menu, "menu"));
  it("servers", () => close(servers(m, from, to), golden.servers, "servers"));
  it("parties", () => close(parties(m, from, to), golden.parties, "parties"));
  it("dayparts", () => close(dayparts(m, from, to), golden.dayparts, "dayparts"));
  it("channels", () => close(channels(m, from, to), golden.channels, "channels"));
  it("before and after", () => {
    const w0 = weekOf(m.minDay);
    close(beforeAfter(m, "dpc", w0 + 14 * 7), golden.beforeAfter.dpc_from_week15, "dpc");
    close(beforeAfter(m, "noShow", w0 + 18 * 7), golden.beforeAfter.noShow_from_week19, "noShow");
    close(beforeAfter(m, "turn", w0 + 20 * 7), golden.beforeAfter.turn_from_week21, "turn");
  });
  it("stored summaries give the same summary and heatmap as the raw rows", () => {
    const days = dayRows(m);
    const hours = hourRows(m);
    close(summaryFromDays(days, m.hasCost, from, to), golden.summary, "stored summary");
    const h = heatFromStored(hours, days, from, to, seats);
    close({ ...h, grid: h.grid.map((g) => ({ days: g.days, rev: g.cells.map((c) => c?.rev ?? null), occ: g.cells.map((c) => c?.occ ?? null) })) }, golden.heat, "stored heat");
    const a = tiles(modelSource(m, seats), period(m, 12));
    const b = tiles(storedSource(days, hours, m.hasCost, seats), period(m, 12));
    close(b, a, "tiles");
  });
  it("the 12-week period matches the golden range, with its prior", () => {
    const p = period(m, 12);
    expect([isoDay(p.from), isoDay(p.to), isoDay(p.prior!.from), isoDay(p.prior!.to)]).toEqual([golden.range.from, golden.range.to, golden.range.priorFrom, golden.range.priorTo]);
    expect(period(m, 0).prior).toBeNull();
  });
  it("tiles carry change on the prior period", () => {
    const t = tiles(modelSource(m, seats), period(m, 12));
    expect(t.map((x) => x.key)).toEqual(["salesPerWeek", "coversPerWeek", "sph", "dpc", "turn", "peakFriSat", "lateShare", "noShow", "gp"]);
    expect(t[0]!.value).toBeCloseTo(golden.summary.salesPerWeek, 3);
    expect(t[0]!.change).toBeCloseTo(golden.summary.salesPerWeek / golden.prior.salesPerWeek - 1, 6);
    expect(t[5]!.value).toBeCloseTo(golden.heat.peakFriSat, 3);
  });
  it("attention flags name the late slot and the server gap", () => {
    const f = attention(m, from, to, heat(m, from, to, seats));
    expect(f[0]!.level).toBe("hot");
    expect(f[0]!.text).toContain("£5.01");
    expect(f[1]!.text).toContain("£624 a week");
  });
  it("a before-and-after test readout equals beforeAfter, and passes its mark", () => {
    const start = weekOf(m.minDay) + 14 * 7;
    const r = readout(m, { metric: "dpc", guardrail: "turn", design: "before_after", startDay: start, endDay: null, passMarkPct: 8 });
    close({ before: r.primary.control, after: r.primary.test, change: r.primary.change, weeksAfter: r.weeks }, golden.beforeAfter.dpc_from_week15, "readout");
    expect(r.verdict).toBe("passed");
    expect(r.guardrail!.key).toBe("turn");
    expect(r.guardrailBreached).toBe(false);
    expect(yearlyValue(m, r.primary)).toBeGreaterThan(30000);
  });
  it("alternate weeks compares on-weeks with off-weeks inside the test dates", () => {
    const start = weekOf(m.maxDay) - 21;
    const r = readout(m, { metric: "sph", guardrail: null, design: "alternate_weeks", startDay: start, endDay: start + 27, passMarkPct: 5 });
    const on = (summary(m, start, start + 6).sales + summary(m, start + 14, start + 20).sales) / (summary(m, start, start + 6).covers + summary(m, start + 14, start + 20).covers);
    const off = (summary(m, start + 7, start + 13).sales + summary(m, start + 21, start + 27).sales) / (summary(m, start + 7, start + 13).covers + summary(m, start + 21, start + 27).covers);
    expect(r.primary.test).toBeCloseTo(on, 8);
    expect(r.primary.control).toBeCloseTo(off, 8);
    expect(r.weeks).toBe(4);
  });
  it("split by section compares test tables with the rest", () => {
    const start = weekOf(m.maxDay) - 21;
    const r = readout(m, { metric: "sph", guardrail: "noShow", design: "split_section", startDay: start, endDay: null, passMarkPct: 5, tables: ["T1", "t2", " T3 "] });
    const inT = m.checks.filter((c) => c.day >= start && ["T1", "T2", "T3"].includes(c.table));
    expect(r.primary.test).toBeCloseTo(inT.reduce((a, c) => a + c.net, 0) / inT.reduce((a, c) => a + c.covers, 0), 8);
    expect(r.primary.control).not.toBeNull();
    expect(r.guardrail!.change).toBeNull(); // bookings cannot be split by table
  });
  it("a test that starts after the data is not started", () => {
    expect(readout(m, { metric: "sph", guardrail: null, design: "before_after", startDay: m.maxDay + 5, endDay: null, passMarkPct: 5 }).verdict).toBe("not_started");
  });
  it("scorecard: the week, the week before and the four weeks before", () => {
    const week = weekOf(m.maxDay);
    const sc = scorecard(storedSource(dayRows(m), hourRows(m), m.hasCost, seats), week);
    const last = golden.weekly[golden.weekly.length - 1];
    const prev = golden.weekly[golden.weekly.length - 2];
    expect(sc.tiles[0]!.value).toBeCloseTo(last.sales, 3);
    expect(sc.tiles[0]!.priorWeek).toBeCloseTo(prev.sales, 3);
    expect(sc.tiles[2]!.fourWeek).toBeCloseTo(summary(m, week - 28, week - 1).sph!, 6);
  });
  it("minimum spend grid: normal sales for the slot, plus the premium", () => {
    const h = heat(m, from, to, seats);
    const g = minSpendGrid(h, seats, 0.2);
    expect(g[0]).toEqual([null, null, null, null]); // closed Mondays
    const sat = g[5]![3]!;
    const satSales = m.checks.filter((c) => c.day >= from && c.day <= to && dow(c.day) === 5).reduce((a, c) => a + c.net, 0) / 12;
    expect(sat.normal).toBeCloseTo(satSales, 4);
    expect(sat.minimum).toBeCloseTo(satSales * 1.2, 4);
  });
});

describe("parseTime", () => {
  it("reads ISO", () => expect(parseTime("2026-11-14T19:05:30")).toBe(Date.UTC(2026, 10, 14, 19, 5, 30)));
  it("reads YYYY-MM-DD HH:MM", () => expect(parseTime("2026-11-14 19:05")).toBe(Date.UTC(2026, 10, 14, 19, 5)));
  it("reads UK DD/MM/YYYY HH:MM", () => expect(parseTime("14/11/2026 19:05")).toBe(Date.UTC(2026, 10, 14, 19, 5)));
  it("reads a bare date as midnight", () => expect(parseTime("03/04/2026")).toBe(Date.UTC(2026, 3, 3)));
  it("rejects anything else", () => {
    expect(parseTime("yesterday")).toBeNaN();
    expect(parseTime(null)).toBeNaN();
    expect(parseTime("")).toBeNaN();
  });
});

describe("trading day", () => {
  const sat = bizDay(Date.UTC(2026, 10, 14, 20));
  it("00:30 on Sunday belongs to Saturday, at trading hour 24.5", () => {
    const ts = Date.UTC(2026, 10, 15, 0, 30);
    expect(bizDay(ts)).toBe(sat);
    expect(bizHour(ts)).toBe(24.5);
    expect(dow(bizDay(ts))).toBe(5);
  });
  it("04:59 is still the night before; 05:00 starts the new day", () => {
    expect(bizDay(Date.UTC(2026, 10, 15, 4, 59))).toBe(sat);
    expect(bizDay(Date.UTC(2026, 10, 15, 5, 0))).toBe(sat + 1);
    expect(bizHour(Date.UTC(2026, 10, 15, 5, 0))).toBe(5);
  });
  it("weeks start on Monday", () => expect(isoDay(weekOf(sat))).toBe("2026-11-09"));
});

describe("column matching and defaults", () => {
  it("matches headers loosely and through aliases", () => {
    const r = fromRows({ checks: [{ "Check ID": "A1", " Opened-At ": "14/11/2026 19:05", Guests: "3", Waiter: "Sam", "Net Sales": "£1,250.50" }] });
    expect(r.errors).toEqual([]);
    expect(r.data.checks[0]).toMatchObject({ id: "A1", open: Date.UTC(2026, 10, 14, 19, 5), covers: 3, server: "Sam", net: 1250.5, close: null });
  });
  it("defaults covers to 1, server to Unknown, and sums net from items when missing", () => {
    const r = fromRows({
      checks: [{ check_id: "A1", opened_at: "2026-11-14 19:00", covers: "0" }],
      items: [{ check: "A1", name: "Paloma", cat: "Cocktails", quantity: "2", line_total: "23" }, { check_id: "A1", item: "Tacos", net_price: "12.5" }, { check_id: "ZZ", item: "Orphan", net_price: "99" }],
    });
    expect(r.data.checks[0]).toMatchObject({ covers: 1, server: "Unknown" });
    expect(r.data.checks[0]!.net).toBeNaN();
    const model = build(r.data);
    expect(model.checks[0]!.net).toBe(35.5);
    expect(model.checks[0]!.drinkQty).toBe(2);
    expect(model.items.length).toBe(2); // the orphan line is ignored
    expect(r.data.items[1]).toMatchObject({ cat: "Other", group: "food", qty: 1, cost: 0 });
  });
  it("uses the group column for drink detection when present", () => {
    const r = fromRows({ checks: [{ id: "1", date: "2026-11-14" }], items: [{ check_id: "1", item: "House red", category: "Reds", type: "Wine" }, { check_id: "1", item: "Bar snacks", category: "Bar", group: "Food" }] });
    expect(r.data.items.map((i) => i.group)).toEqual(["drink", "food"]);
  });
  it("reads booking status, default size and lead time", () => {
    const r = fromRows({ checks: [{ id: "1", date: "2026-11-14" }], bookings: [{ datetime: "2026-11-14 19:00", status: "No Show", booked_at: "2026-11-10 12:30" }, { booked_for: "2026-11-14 20:00", status: "Cancelled by guest", covers: "6" }, { booked_for: "2026-11-14 20:00" }] });
    expect(r.data.bookings.map((b) => [b.id, b.size, b.status, b.lead])).toEqual([["0", 2, "no_show", 4], ["1", 6, "cancelled", null], ["2", 2, "seated", null]]);
  });
  it("reports rows it cannot use, and an empty checks file", () => {
    const r = fromRows({ checks: [{ check_id: "A1" }], items: [{ item: "x" }] });
    expect(r.errors[0]).toMatch(/No usable rows/);
    expect(r.errors).toHaveLength(3);
  });
  it("autoMap pairs each field with one header, preferring a saved mapping", () => {
    const headers = ["Order ID", "Date", "Total", "Pax", "Till total"];
    expect(autoMap("checks", headers)).toMatchObject({ check_id: "Order ID", opened_at: "Date", net_total: "Total", covers: "Pax", closed_at: null });
    const saved = autoMap("checks", headers, { net_total: "Till total" });
    expect(saved.net_total).toBe("Till total");
    expect(applyMap({ "Order ID": "9", Date: "2026-11-14", "Till total": "10" }, saved)).toEqual({ check_id: "9", opened_at: "2026-11-14", net_total: "10", covers: undefined });
    expect(FIELDS.checks.filter((f) => f.required).map((f) => f.field)).toEqual(["check_id", "opened_at"]);
  });
});

describe("events, bridge and limits", () => {
  it("event net gain matches a hand calculation", () => {
    // 6,000 − 1,500 − 600 − 250 − 2,000 × 0.55 = 2,550
    expect(eventNetGain({ revenue: 6000, costOfGoods: 1500, extraLabour: 600, directCosts: 250, displacedSales: 2000, contributionRate: 0.55 })).toBeCloseTo(2550, 6);
  });
  it("bridge steps add up to the plan", () => {
    const b = bridge(bridgeDefaults(900000));
    expect(b.steps.map((s) => Math.round(s.adds))).toEqual([900000, 225000, 168750, 375000, 280000, 120000, 150000, 100000]);
    expect(b.total).toBe(2318750);
    expect(b.multiple).toBeCloseTo(2.5764, 4);
    expect(b.gap).toBe(2700000 - 2318750);
  });
  it("warns on more than four live tests and on a shared metric", () => {
    expect(liveTestWarnings([{ name: "a", metric: "sph" }, { name: "b", metric: "dpc" }])).toEqual([]);
    const w = liveTestWarnings(["a", "b", "c", "d", "e"].map((name) => ({ name, metric: name < "c" ? "sph" : name })));
    expect(w).toHaveLength(2);
    expect(w[1]).toContain("Spend per head");
  });
});
