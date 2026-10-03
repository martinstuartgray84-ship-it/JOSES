import { describe, expect, it } from "vitest";
import { forecastCovers, opsAlerts, planStaffing, preBatch, prepList, serverLoads, stationLoad, DEFAULT_RATIOS, type StationNow } from "./ops";

describe("forecastCovers", () => {
  it("adds walk-ins, removes expected no-shows, and spreads guests over their stay", () => {
    const f = forecastCovers({
      bookings: [
        { hour: 19, covers: 20 },
        { hour: 19, covers: 10 },
        { hour: 20, covers: 10 },
      ],
      walkInsByHour: { 18: 4, 19: 6 },
      noShowRate: 0.1,
      dwellMinutes: 90,
      openHours: [18, 19, 20],
    });
    const h = (n: number) => f.find((x) => x.hour === n)!;
    expect(h(19)).toMatchObject({ booked: 27, walkIns: 6, arrivals: 33 });
    // Arrive 19:30 on average, stay 90 min: 19:30–21:00. Hour 19 gets half of them, hour 20 all, hour 21 none.
    expect(h(18).inHouse).toBe(2); // 4 walk-ins from 18:30, half an hour
    expect(h(19).inHouse).toBe(4 + 16.5); // 18:30 arrivals all hour; 19:30 arrivals half
    expect(h(20).inHouse).toBe(33 + 4.5); // 19:30 group all hour; 20:30 group half
    expect(h(21).inHouse).toBe(9); // 20:30 group until 22:00
    expect(f[f.length - 1]!.hour).toBe(21);
  });
});

describe("planStaffing", () => {
  const forecast = [
    { hour: 17, booked: 0, walkIns: 0, arrivals: 0, inHouse: 0 },
    { hour: 18, booked: 10, walkIns: 2, arrivals: 12, inHouse: 6 },
    { hour: 19, booked: 40, walkIns: 6, arrivals: 46, inHouse: 50 },
  ];
  const usage = { drinksPerCoverHour: 1.2, platesPerCover: 2.2 };

  it("sizes each role from its own driver, with minimums when open", () => {
    const s = planStaffing(forecast, usage);
    expect(s[0]).toMatchObject({ servers: 0, bar: 0, kitchen: 0 }); // closed
    expect(s[1]).toMatchObject({ servers: 1, bar: 1, kitchen: 1 });
    // 50 in: 50/16 → 4 servers; 60 drinks/45 → 2 bar; plates 46×2.2×0.7 + 4×2.2×0.3 ≈ 73.5 → 4 cooks.
    expect(s[2]).toMatchObject({ servers: 4, bar: 2, drinks: 60, plates: 73, kitchen: 4 });
  });

  it("names the tightest role", () => {
    const s = planStaffing(forecast, { drinksPerCoverHour: 3, platesPerCover: 1 });
    expect(s[2]!.tightest).toBe("bar");
  });
});

describe("prep and batching", () => {
  it("preps expected portions plus a buffer, minus what's on hand", () => {
    const list = prepList(
      80,
      [
        { name: "Ribeye", perCover: 0.25 },
        { name: "Risotto", perCover: 0.12 },
        { name: "Rare thing", perCover: 0.002 },
      ],
      { onHand: { Risotto: 4 } },
    );
    expect(list).toEqual([
      { name: "Ribeye", expected: 20, prep: 23 },
      { name: "Risotto", expected: 9.6, prep: 8 },
    ]);
  });

  it("suggests batching cocktails that will sell enough at the peak", () => {
    expect(preBatch(60, 1.2, [{ name: "Espresso martini", share: 0.15 }, { name: "Negroni", share: 0.06 }, { name: "Spritz", share: 0.12 }])).toEqual([
      { name: "Espresso martini", expected: 11 },
      { name: "Spritz", expected: 9 },
    ]);
  });
});

describe("live load", () => {
  const now = new Date("2026-10-09T19:00:00Z");
  const ago = (m: number) => new Date(now.getTime() - m * 60_000);

  it("measures a station's queue and how long it takes to clear", () => {
    const l = stationLoad(
      [
        { quantity: 4, prepMinutes: 14, status: "sent", sentAt: ago(9) },
        { quantity: 2, prepMinutes: 10, status: "started", sentAt: ago(12) },
      ],
      2,
      now,
    );
    expect(l).toMatchObject({ items: 6, waiting: 4, cooking: 2, queuedMinutes: 66, clearsInMinutes: 11, oldestWaitMinutes: 9, level: "busy" });
    expect(stationLoad([], 2, now).level).toBe("ok");
    expect(stationLoad([{ quantity: 1, prepMinutes: 5, status: "sent", sentAt: ago(16) }], 2, now).level).toBe("overloaded");
  });

  it("flags servers with too many guests or too much undone", () => {
    const loads = serverLoads([
      { server: "Tom", covers: 12, urgent: 0 },
      { server: "Tom", covers: 10, urgent: 1 },
      { server: "Aisha", covers: 6, urgent: 2 },
      { server: null, covers: 2, urgent: 0 },
    ]);
    expect(loads.map((l) => [l.name, l.covers, l.level])).toEqual([
      ["Tom", 22, "overloaded"],
      ["Aisha", 6, "busy"],
      ["Unassigned", 2, "ok"],
    ]);
    expect(DEFAULT_RATIOS.coversPerServer).toBe(16);
  });
});

describe("opsAlerts", () => {
  const station = (o: Partial<StationNow>): StationNow => ({
    code: "kitchen", name: "Kitchen", kind: "kitchen", items: 0, waiting: 0, cooking: 0, queuedMinutes: 0, clearsInMinutes: 0,
    oldestWaitMinutes: 0, level: "ok", readyWaiting: 0, oldestReadyMinutes: 0, ...o,
  });

  it("tells the kitchen to stagger fires and someone to run waiting drinks", () => {
    const a = opsAlerts({
      stations: [
        station({ level: "overloaded", waiting: 10, cooking: 4, clearsInMinutes: 22, oldestWaitMinutes: 12 }),
        station({ code: "bar", name: "Bar", kind: "bar", readyWaiting: 4, oldestReadyMinutes: 7 }),
      ],
      servers: [],
      arrivingSoon: 14,
      mainsDue: 3,
    });
    expect(a.map((x) => [x.area, x.severity, x.title])).toEqual([
      ["kitchen", 1, "Kitchen overloaded"],
      ["bar", 1, "4 drinks waiting at the bar"],
      ["door", 1, "14 booked guests in the next 30 min"],
    ]);
    expect(a[0]!.detail).toContain("Stagger the 3 mains");
  });

  it("moves work from the busiest server to the lightest", () => {
    const servers = serverLoads([
      { server: "Tom", covers: 22, urgent: 2 },
      { server: "Aisha", covers: 6, urgent: 0 },
      { server: "Leo", covers: 10, urgent: 0 },
      { server: null, covers: 2, urgent: 0 },
    ]);
    const a = opsAlerts({ stations: [station({})], servers, arrivingSoon: 0, mainsDue: 0 });
    expect(a.map((x) => x.title)).toEqual(["Tom has 22 guests, 2 things overdue", "1 table with no server"]);
    expect(a[0]!.detail).toMatch(/^Aisha \(6 guests\) picks up Tom/);
  });

  it("flags uneven sections before anyone is overloaded, and stays quiet when all is well", () => {
    const uneven = serverLoads([{ server: "Tom", covers: 15, urgent: 0 }, { server: "Aisha", covers: 4, urgent: 0 }]);
    expect(opsAlerts({ stations: [], servers: uneven, arrivingSoon: 0, mainsDue: 0 }).map((x) => x.title)).toEqual(["Sections are uneven"]);
    const fine = serverLoads([{ server: "Tom", covers: 8, urgent: 0 }, { server: "Aisha", covers: 6, urgent: 0 }]);
    expect(opsAlerts({ stations: [station({})], servers: fine, arrivingSoon: 4, mainsDue: 0 })).toEqual([]);
  });
});
