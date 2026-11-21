// Integration tests for the Growth Console. Run via `npm run test:db`.
import { readFileSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dayFromIso, heat, isoDay, menu, period, servers, summary, tiles, weekOf } from "../growth/engine";
import { clearData, dataStatus, getSettings, importChunk, importFile, finishImport, listImports, loadModel, loadSample, loadStored, saveSettings, savedMappings, startImport } from "./growth";
import { addAction, listActions, listBets, listDecisions, listMeetings, loadStarter, logTurnaway, saveBet, saveDecision, saveMeeting, setActionStatus, turnawayTally } from "./growth-office";
import { addIdea, buildScorecard, createTest, decideTest, emailScorecard, listEvents, listScorecards, markRead, programme, recheckGain, runScorecards, saveBridge, getBridge, saveEnquiry, listEnquiries, saveEvent, startTest } from "./growth-programme";

const url = process.env.DATABASE_URL;
const dir = path.join(__dirname, "../../fixtures/growth");
const golden = JSON.parse(readFileSync(path.join(dir, "golden.json"), "utf8"));
const file = (k: string) => readFileSync(path.join(dir, "sample", `${k}.csv`), "utf8");

describe.skipIf(!url)("Growth Console", () => {
  const sql = postgres(url ?? "", { onnotice: () => {} });
  afterAll(() => sql.end());
  let venue = "";
  let other = "";

  beforeAll(async () => {
    const tag = `growth${Date.now()}`;
    const [c] = await sql`insert into companies (name, slug) values ('Growth Co', ${tag}) returning id`;
    const [v] = await sql`insert into venues (company_id, name, slug) values (${c!.id}, 'Growth Site', ${tag}) returning id`;
    const [o] = await sql`insert into venues (company_id, name, slug) values (${c!.id}, 'Other Site', ${tag + "b"}) returning id`;
    venue = v!.id;
    other = o!.id;
  });

  it("starts with default settings and no data", async () => {
    const s = await getSettings(sql, venue);
    expect(s.seats).toBe(60);
    expect(s.gainAreas).toHaveLength(8);
    expect(await loadModel(sql, venue)).toBeNull();
    expect(await loadStored(sql, venue)).toBeNull();
  });

  it("refuses items before checks, and a mapping without the required columns", async () => {
    await expect(startImport(sql, venue, { kind: "items", filename: "i.csv", headers: ["check_id", "item"], mapping: { check_id: "check_id", item: "item" } })).rejects.toThrow(/checks file first/);
    await expect(startImport(sql, venue, { kind: "checks", filename: "c.csv", headers: ["a", "b"], mapping: { check_id: "a" } })).rejects.toThrow(/opened_at/);
  });

  it("loads the sample CSVs with zero skipped rows", async () => {
    const t0 = Date.now();
    await loadSample(sql, venue);
    const imports = await listImports(sql, venue);
    expect(imports).toHaveLength(3);
    for (const i of imports) expect([i.kind, i.status, i.rowsSkipped, i.sample]).toEqual([i.kind, "loaded", 0, true]);
    const by = Object.fromEntries(imports.map((i) => [i.kind, i]));
    expect([by.checks!.rowsLoaded, by.items!.rowsLoaded, by.bookings!.rowsLoaded]).toEqual([golden.counts.checks, golden.counts.items, golden.counts.bookings]);
    expect([by.checks!.rowsNew, by.items!.rowsNew, by.bookings!.rowsNew]).toEqual([golden.counts.checks, golden.counts.items, golden.counts.bookings]);
    expect([by.checks!.firstDay, by.checks!.lastDay]).toEqual([golden.range.minDay, golden.range.maxDay]);
    expect(await dataStatus(sql, venue)).toMatchObject({ ...golden.counts, sample: true, firstDay: golden.range.minDay, lastDay: golden.range.maxDay });
    expect(Date.now() - t0).toBeLessThan(120_000);
  });

  it("gives the golden figures from the database, from raw rows and from stored summaries", async () => {
    const m = (await loadModel(sql, venue))!;
    const from = dayFromIso(golden.range.from);
    const to = dayFromIso(golden.range.to);
    const s = summary(m, from, to);
    for (const k of Object.keys(golden.summary)) expect(s[k as keyof typeof s], k).toBeCloseTo(golden.summary[k], 4);
    const h = heat(m, from, to, 60);
    expect(h.peakFriSat).toBeCloseTo(golden.heat.peakFriSat, 4);
    expect(servers(m, from, to).gapPerWeek).toBeCloseTo(golden.servers.gapPerWeek, 4);
    expect(menu(m, from, to).map((o) => [o.item, o.cls])).toEqual(golden.menu.map((o: { item: string; cls: string }) => [o.item, o.cls]));
    const stored = (await loadStored(sql, venue))!;
    const ss = stored.source.summary(from, to);
    for (const k of Object.keys(golden.summary)) expect(ss[k as keyof typeof ss], `stored ${k}`).toBeCloseTo(golden.summary[k], 4);
    expect(stored.source.heat(from, to).lateFriSat).toBeCloseTo(golden.heat.lateFriSat, 4);
    expect(tiles(stored.source, period(m, 12)).map((t) => t.value)).toEqual(tiles(stored.source, period(stored.source, 12)).map((t) => t.value));
  });

  it("re-uploading the same files adds zero rows", async () => {
    const before = await dataStatus(sql, venue);
    for (const k of ["checks", "items", "bookings"] as const) {
      const r = await importFile(sql, venue, k, `${k}.csv`, file(k));
      expect([k, r.rowsNew, r.rowsSkipped, r.rowsLoaded]).toEqual([k, 0, 0, golden.counts[k]]);
    }
    expect(await dataStatus(sql, venue)).toMatchObject({ checks: before.checks, items: before.items, bookings: before.bookings, sample: false });
    const m = (await loadModel(sql, venue))!;
    expect(summary(m, dayFromIso(golden.range.from), dayFromIso(golden.range.to)).sales).toBeCloseTo(golden.summary.sales, 4);
  });

  it("loads a file in pieces, with item lines for one check split across pieces", async () => {
    const id = await startImport(sql, other, { kind: "checks", filename: "c.csv", headers: ["Check ID", "Opened", "Pax", "Total"], mapping: { check_id: "Check ID", opened_at: "Opened", covers: "Pax", net_total: "Total" } });
    await importChunk(sql, other, id, "A1,14/11/2026 19:05,2,£50.00\nA2,not a date,2,10\n");
    await importChunk(sql, other, id, ",2026-11-14 20:00,2,10\nA3,2026-11-15 00:30,4,\nA1,14/11/2026 19:05,3,£60.00\n");
    const r = await finishImport(sql, other, id);
    expect([r.rowsRead, r.rowsLoaded, r.rowsNew, r.rowsSkipped]).toEqual([5, 3, 2, 2]);
    expect(r.report.reasons).toEqual({ "opened_at missing or not a date (use YYYY-MM-DD HH:MM)": 1, "No check_id": 1 });
    expect(r.report.examples.map((e) => e.row)).toEqual([3, 4]);
    expect([r.firstDay, r.lastDay]).toEqual(["2026-11-14", "2026-11-14"]); // 00:30 Sunday is Saturday's trading day
    expect((await savedMappings(sql, other)).checks).toMatchObject({ check_id: "Check ID", net_total: "Total" });

    const items = await startImport(sql, other, { kind: "items", filename: "i.csv", headers: ["check_id", "item", "category", "net_price"], mapping: { check_id: "check_id", item: "item", category: "category", net_price: "net_price" } });
    await importChunk(sql, other, items, "A3,Tacos,Main,12.50\nA3,Paloma,Cocktail,11.50\nZZ,Orphan,Main,5\n");
    await importChunk(sql, other, items, "A3,Churros,Dessert,7\n");
    const ir = await finishImport(sql, other, items);
    expect([ir.rowsLoaded, ir.rowsNew, ir.rowsSkipped]).toEqual([3, 3, 1]);
    expect(ir.report.reasons).toEqual({ "Its check is not in the checks file": 1 });
    expect((await sql`select line_no, item from growth_items where venue_id = ${other} order by line_no`).map((x) => [x.line_no, x.item])).toEqual([[1, "Tacos"], [2, "Paloma"], [3, "Churros"]]);
    // Loading the items again replaces the three lines rather than adding to them.
    const again = await importFile(sql, other, "items", "i.csv", "check_id,item,category,net_price\nA3,Tacos,Main,12.50\nA3,Paloma,Cocktail,11.50\nA3,Churros,Dessert,7\n");
    expect([again.rowsLoaded, again.rowsNew]).toEqual([3, 0]);
    expect((await sql`select count(*)::int as n from growth_items where venue_id = ${other}`)[0]!.n).toBe(3);

    const m = (await loadModel(sql, other))!;
    const a3 = m.checks.find((c) => c.id === "A3")!;
    expect([a3.net, a3.drinkQty, a3.desserts, a3.hour, isoDay(a3.day)]).toEqual([31, 1, 1, 24.5, "2026-11-14"]); // net summed from items
    expect(m.checks.find((c) => c.id === "A1")!.net).toBe(60);
    await expect(importChunk(sql, other, items, "A3,Late,Main,1\n")).rejects.toThrow(/already finished/);
    await expect(importChunk(sql, venue, id, "x")).rejects.toThrow(/no longer exists/); // another venue's import
  });

  it("saves settings, and rejects bad ones", async () => {
    const s = await getSettings(sql, venue);
    await saveSettings(sql, venue, { ...s, seats: 72, tradingHours: { mon: null, tue: ["17:00", "23:00"] }, scorecardEmails: ["Manager@Example.com "], gainAreas: [{ name: "Bar", captain: "Sofia" }] });
    expect(await getSettings(sql, venue)).toMatchObject({ seats: 72, scorecardEmails: ["manager@example.com"], gainAreas: [{ name: "Bar", captain: "Sofia" }], tradingHours: { mon: null, tue: ["17:00", "23:00"], sun: null } });
    await expect(saveSettings(sql, venue, { ...s, seats: 0 })).rejects.toThrow(/Seats/);
    await expect(saveSettings(sql, venue, { ...s, scorecardEmails: ["nope"] })).rejects.toThrow(/email/);
    await saveSettings(sql, venue, { ...s, seats: 60, scorecardEmails: ["manager@example.com"] });
  });

  it("takes an idea to a live test, reads it and banks the gain", async () => {
    const ideaId = await addIdea(sql, venue, { gainArea: "Bar", change: "Offer a named drink within two minutes", metricKey: "dpc", proposerName: "Camila" });
    const m = (await loadModel(sql, venue))!;
    const start = isoDay(weekOf(m.minDay) + 14 * 7);
    const testId = await createTest(sql, venue, { ideaId, name: "First drink in two minutes", gainArea: "Bar", metricKey: "dpc", guardrailKey: "turn", design: "before_after", startDay: start, passMarkPct: 5, ownerName: "Sofia" });
    let p = await programme(sql, venue);
    expect(p.ideas[0]!.status).toBe("testing");
    expect(p.tests[0]).toMatchObject({ status: "planned", name: "First drink in two minutes" });
    await expect(decideTest(sql, venue, testId, { decision: "bank", decidedBy: "Jo" })).rejects.toThrow(/Read the test/);
    await startTest(sql, venue, testId);
    const r = await markRead(sql, venue, testId);
    expect(r.primary.change).toBeCloseTo(golden.beforeAfter.dpc_from_week15.change, 4);
    expect(r.verdict).toBe("passed");
    p = await programme(sql, venue);
    expect(p.tests[0]!.status).toBe("read");
    expect(p.tests[0]!.suggestedValue).toBeGreaterThan(30_000);
    await expect(decideTest(sql, venue, testId, { decision: "bank", decidedBy: "" })).rejects.toThrow(/who made the decision/);
    await decideTest(sql, venue, testId, { decision: "bank", decidedBy: "Jo", yearlyValue: "48,000" });
    p = await programme(sql, venue);
    expect(p.tests[0]).toMatchObject({ status: "banked", decidedBy: "Jo" });
    expect(p.gains[0]).toMatchObject({ name: "First drink in two minutes", yearlyValue: 48000, stillHolding: null, recheckDue: false });
    expect(p.gains[0]!.changePct).toBeCloseTo(12.18, 1);
    expect(p.total).toBe(48000);
    await recheckGain(sql, venue, p.gains[0]!.id, false);
    expect((await programme(sql, venue)).total).toBe(0);
    await recheckGain(sql, venue, p.gains[0]!.id, true);
  });

  it("warns when live tests share a metric, and stopping a test reopens its idea", async () => {
    const ideaId = await addIdea(sql, venue, { gainArea: "Floor service", change: "Suggest churros", metricKey: "dessertAttach" });
    const mk = (name: string, extra = {}) => createTest(sql, venue, { name, gainArea: "Floor service", metricKey: "sph", design: "alternate_weeks", startDay: "2026-11-02", endDay: "2026-11-15", passMarkPct: 3, live: true, ...extra });
    const a = await mk("A", { ideaId });
    await mk("B");
    const p = await programme(sql, venue);
    expect(p.warnings.join(" ")).toMatch(/share the same primary metric/);
    expect(p.tests.find((t) => t.id === a)!.read!.testLabel).toBe("On-weeks");
    await decideTest(sql, venue, a, { decision: "stop", decidedBy: "Jo", notes: "Clashed with B" });
    const after = await programme(sql, venue);
    expect(after.tests.find((t) => t.id === a)).toMatchObject({ status: "stopped", notes: "Clashed with B" });
    expect(after.ideas.find((i) => i.id === ideaId)!.status).toBe("open");
    await expect(createTest(sql, venue, { name: "x", gainArea: "Bar", metricKey: "sph", guardrailKey: "sph", design: "before_after", startDay: "2026-11-02", passMarkPct: 3 })).rejects.toThrow(/different number/);
    await expect(createTest(sql, venue, { name: "x", gainArea: "Bar", metricKey: "sph", design: "split_section", startDay: "2026-11-02", passMarkPct: 3 })).rejects.toThrow(/tables/);
  });

  it("builds the weekly scorecard from stored summaries and emails it once", async () => {
    expect(await buildScorecard(sql, venue, "2026-11-16")).toBeNull(); // nothing loaded for that week
    await expect(buildScorecard(sql, venue, "2026-11-10")).rejects.toThrow(/Monday/);
    // Monday 16 November, 06:59 London: too early. 07:00: builds last week's and emails it. An hour later: nothing more to do.
    expect(await runScorecards(sql, { venueId: venue, now: new Date("2026-11-16T06:59:00Z") })).toEqual({ built: 0, emailed: 0 });
    expect(await runScorecards(sql, { venueId: venue, now: new Date("2026-11-16T07:00:00Z") })).toEqual({ built: 1, emailed: 1 });
    expect(await runScorecards(sql, { venueId: venue, now: new Date("2026-11-16T08:00:00Z") })).toEqual({ built: 0, emailed: 0 });
    const [sc] = await listScorecards(sql, venue);
    const last = golden.weekly[golden.weekly.length - 1];
    expect(sc!.weekStart).toBe("2026-11-09");
    expect(sc!.emailedTo).toEqual(["manager@example.com"]);
    expect(sc!.payload.tiles[0]).toMatchObject({ key: "salesPerWeek", value: last.sales });
    expect(sc!.payload.tiles[2]!.value).toBeCloseTo(last.sph, 4);
    expect(sc!.payload.tiles).toHaveLength(9);
    expect(sc!.payload.liveTests.map((t) => t.name)).toEqual(["B"]);
    expect((await emailScorecard(sql, venue, "2026-11-09")).status).toBe("logged"); // no email provider in tests
  });

  it("keeps the bridge, enquiries and events per venue", async () => {
    expect(await getBridge(sql, venue)).toBeNull();
    await saveBridge(sql, venue, { base: 900000, target: 3, sph: 25, cov: 15, lateN: 150, lateG: 100, lateS: 25, brN: 100, brC: 70, brS: 40, early: 120000, hire: 150000, off: 100000 });
    expect((await getBridge(sql, venue))!.base).toBe(900000);
    await expect(saveBridge(sql, venue, { base: -1 })).rejects.toThrow(/number/);
    await saveEnquiry(sql, venue, { receivedAt: "2026-11-10T09:00", firstReplyAt: "2026-11-10T13:30", source: "Website", eventType: "Birthday", partySize: "30", quote: "1,800", outcome: "lost", lostReason: "Price" });
    const [e] = await listEnquiries(sql, venue);
    expect(e).toMatchObject({ responseHours: 4.5, quote: 1800, outcome: "lost", lostReason: "Price", partySize: 30 });
    await expect(saveEnquiry(sql, venue, { receivedAt: "2026-11-10T09:00", firstReplyAt: "2026-11-09T09:00" })).rejects.toThrow(/before the enquiry/);
    await saveEvent(sql, venue, { name: "Tequila launch", heldOn: "2026-11-12", revenue: 6000, costOfGoods: 1500, extraLabour: 600, directCosts: 250, displacedSales: 2000, contributionRate: 55 });
    expect((await listEvents(sql, venue))[0]!.netGain).toBeCloseTo(2550, 6);
    expect(await listEvents(sql, other)).toEqual([]);
  });

  it("clears loaded data but keeps the programme", async () => {
    await clearData(sql, venue);
    expect(await loadModel(sql, venue)).toBeNull();
    expect(await dataStatus(sql, venue)).toMatchObject({ checks: 0, items: 0, bookings: 0 });
    const p = await programme(sql, venue);
    expect(p.gains).toHaveLength(1);
    expect(p.hasData).toBe(false);
  });

  it("loads the starter pack once, and runs the plan, bets, meetings and turn-aways", async () => {
    expect(await loadStarter(sql, other)).toEqual({ actions: 36, decisions: 9, ideas: 7, bets: 6 });
    expect(await loadStarter(sql, other)).toEqual({ actions: 0, decisions: 0, ideas: 0, bets: 0 });
    const p = await programme(sql, other);
    expect(p.ideas[0]!.change).toMatch(/^First drink in two minutes/);
    expect(p.ideas.map((i) => i.metricKey)).toEqual(["dpc", "dpc", "starterAttach", "dessertAttach", "turn", "noShow", "lateSalesPerWeek"]);

    let actions = await listActions(sql, other);
    expect(actions).toHaveLength(36);
    expect(actions.every((a) => a.status === "open")).toBe(true);
    const a1 = actions.find((a) => a.ref === "A01")!;
    await setActionStatus(sql, other, a1.id, "done");
    await addAction(sql, other, { task: "Order handhelds", owner: "General manager", due: "2099-01-05" });
    await expect(addAction(sql, other, { task: "No owner" })).rejects.toThrow(/owner/);
    actions = await listActions(sql, other);
    expect(actions.find((a) => a.ref === "A01")).toMatchObject({ status: "done", overdue: false });
    expect(actions.find((a) => a.task === "Order handhelds")).toMatchObject({ overdue: false, ref: null });
    await setActionStatus(sql, venue, a1.id, "open"); // another venue cannot touch it
    expect((await listActions(sql, other)).find((a) => a.ref === "A01")!.status).toBe("done");

    const d = (await listDecisions(sql, other))[0]!;
    await saveDecision(sql, other, { id: d.id, decision: "Tres Veces", decidedBy: "Owner" });
    expect((await listDecisions(sql, other))[0]).toMatchObject({ item: "Programme name", decision: "Tres Veces", decidedBy: "Owner" });

    const bets = await listBets(sql, other);
    expect(bets.map((b) => [b.name, b.status, b.passed])[0]).toEqual(["Late-night bar", "active", 0]);
    const late = bets[0]!;
    const form = (g: string[]) => ({ id: late.id, name: late.name, yearlyValue: "375,000", status: "active", gate_test_0: "Licence", gate_status_0: g[0], gate_test_1: "Pilots", gate_status_1: g[1], gate_test_2: "Scale", gate_status_2: g[2] });
    await expect(saveBet(sql, other, form(["pending", "passed", "pending"]))).rejects.toThrow(/gates before it/);
    await saveBet(sql, other, form(["passed", "failed", "pending"]));
    const after = (await listBets(sql, other))[0]!;
    expect([after.passed, after.yearlyValue, after.gates[1]!.status, after.gates[0]!.decided_on]).toEqual([1, 375000, "failed", expect.stringMatching(/^\d{4}-/)]);

    await saveMeeting(sql, other, { kind: "mobilisation", heldOn: "2026-11-21", notes: "DECISIONS\nThree tests agreed." });
    expect((await listMeetings(sql, other))[0]).toMatchObject({ title: "Mobilisation", heldOn: "2026-11-21" });
    await expect(saveMeeting(sql, other, { kind: "party", heldOn: "2026-11-21" })).rejects.toThrow(/kind/);

    const [now] = await sql`select to_char(now() at time zone 'Europe/London', 'YYYY-MM-DD"T"HH24:MI') as t`;
    await logTurnaway(sql, other, { turnedAt: now!.t, partySize: "4", reason: "Fully booked", offeredAlternative: "Bar seats" });
    await logTurnaway(sql, other, { turnedAt: now!.t, partySize: 2, reason: "Fully booked" });
    await logTurnaway(sql, other, { turnedAt: "2020-01-01T20:00", partySize: 6, reason: "Kitchen closed" }); // outside the 28 days
    await expect(logTurnaway(sql, other, { turnedAt: now!.t, partySize: 0, reason: "x" })).rejects.toThrow(/Party size/);
    const t = await turnawayTally(sql, other);
    expect([t.parties, t.guests, t.recent.length]).toEqual([2, 6, 3]);
    expect(t.byReason).toEqual([{ reason: "Fully booked", parties: 2, guests: 6 }]);
    expect((await turnawayTally(sql, venue)).recent).toEqual([]);
  });
});
