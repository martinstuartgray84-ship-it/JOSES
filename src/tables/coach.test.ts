import { describe, expect, it } from "vitest";
import {
  coachTable,
  DEFAULT_BENCHMARK as B,
  drinkRounds,
  expectedPerHeadAt,
  itemKind,
  rankTables,
  type CoachItem,
  type CoachTable,
} from "./coach";

const T0 = new Date("2026-10-09T18:00:00Z"); // 19:00 BST
const at = (m: number) => new Date(T0.getTime() + m * 60_000);

const item = (o: Partial<CoachItem> & Pick<CoachItem, "name" | "kind" | "course">): CoachItem => ({
  quantity: 1,
  status: "served",
  createdAt: at(0),
  sentAt: o.createdAt ?? at(0),
  servedAt: o.createdAt ?? at(0),
  value: 1000,
  ...o,
});

const table = (o: Partial<CoachTable> = {}): CoachTable => ({
  tableId: "t1",
  label: "5",
  seats: 4,
  covers: 2,
  openedAt: at(0),
  items: [],
  daypart: "dinner",
  ...o,
});

const kinds = (r: ReturnType<typeof coachTable>) => r.nudges.map((n) => n.kind);

describe("helpers", () => {
  it("interpolates the spend curve", () => {
    expect(expectedPerHeadAt(B.spendCurve, 0)).toBe(0);
    expect(expectedPerHeadAt(B.spendCurve, 15)).toBe(900);
    expect(expectedPerHeadAt(B.spendCurve, 22.5)).toBe(1300);
    expect(expectedPerHeadAt(B.spendCurve, 500)).toBe(4800);
    expect(expectedPerHeadAt([], 10)).toBeNull();
  });

  it("groups drink lines into rounds", () => {
    const items = [
      item({ name: "a", kind: "drink", course: 0, createdAt: at(2) }),
      item({ name: "b", kind: "wine", course: 0, createdAt: at(4) }),
      item({ name: "c", kind: "drink", course: 0, createdAt: at(35) }),
      item({ name: "d", kind: "food", course: 2, createdAt: at(36) }),
      item({ name: "e", kind: "drink", course: 0, createdAt: at(36), status: "void" }),
    ];
    expect(drinkRounds(items)).toEqual([at(2), at(35)]);
  });

  it("classifies items", () => {
    expect(itemKind(0, "Cocktails")).toBe("drink");
    expect(itemKind(0, "Red wine")).toBe("wine");
    expect(itemKind(0, "Hot drinks")).toBe("hot");
    expect(itemKind(3, "Desserts")).toBe("food");
  });
});

describe("service basics", () => {
  it("flags no drinks after 4 minutes, naming a regular's usual", () => {
    const r = coachTable(table({ guest: { name: "Ana", visits: 9, favouriteDrink: "Negroni" } }), B, at(6));
    expect(r.stage).toBe("seated");
    expect(r.nudges[0]).toMatchObject({ kind: "first_drink", priority: 1, dueFor: 2, value: 1500 });
    expect(r.nudges[0]!.detail).toContain("Ana usually has Negroni");
    expect(kinds(coachTable(table(), B, at(3)))).toEqual([]);
  });

  it("flags drinks stuck at the bar and food not ordered", () => {
    const r = coachTable(
      table({ items: [item({ name: "Spritz", kind: "drink", course: 0, createdAt: at(3), status: "sent", servedAt: null })] }),
      B,
      at(13),
    );
    expect(kinds(r)).toEqual(expect.arrayContaining(["drinks_waiting", "take_order"]));
    expect(kinds(r)).not.toContain("first_drink");
  });

  it("says fire mains when starters have been cleared for 12 minutes", () => {
    const items = [
      item({ name: "Wine", kind: "drink", course: 0, createdAt: at(2) }),
      item({ name: "Soup", kind: "food", course: 1, createdAt: at(10), servedAt: at(22) }),
      item({ name: "Steak", kind: "food", course: 2, createdAt: at(10), status: "held", sentAt: null, servedAt: null }),
    ];
    expect(coachTable(table({ items }), B, at(30)).stage).toBe("starters");
    expect(kinds(coachTable(table({ items }), B, at(33)))).not.toContain("fire_mains"); // 11 min: not yet
    expect(coachTable(table({ items }), B, at(34)).nudges[0]).toMatchObject({ kind: "fire_mains", priority: 1 });
  });
});

describe("selling moments", () => {
  const meal = (upTo: "mains" | "dessert") => [
    item({ name: "Spritz", kind: "drink", course: 0, createdAt: at(3), quantity: 2 }),
    item({ name: "Soup", kind: "food", course: 1, createdAt: at(10), servedAt: at(25) }),
    item({ name: "Steak", kind: "food", course: 2, createdAt: at(10), sentAt: at(35), servedAt: at(52), status: "served" }),
    item({ name: "Cod", kind: "food", course: 2, createdAt: at(10), sentAt: at(35), servedAt: at(52), status: "served" }),
    ...(upTo === "dessert" ? [item({ name: "Tart", kind: "food", course: 3, createdAt: at(70), servedAt: at(78) })] : []),
  ];

  it("offers the next round 25 minutes after the last drinks at dinner", () => {
    const items = [item({ name: "Spritz", kind: "drink", course: 0, createdAt: at(3), quantity: 2 }), item({ name: "Soup", kind: "food", course: 1, createdAt: at(10), status: "started", servedAt: null })];
    expect(kinds(coachTable(table({ items }), B, at(27)))).not.toContain("next_round");
    const r = coachTable(table({ items }), B, at(29));
    expect(kinds(r)).toContain("next_round");
    expect(r.rounds).toBe(1);
    // Lunch waits a little longer.
    expect(kinds(coachTable(table({ items, daypart: "lunch" }), B, at(29)))).not.toContain("next_round");
  });

  it("suggests wine with mains when nothing's been ordered to drink with the food", () => {
    const items = [
      item({ name: "Lager", kind: "drink", course: 0, createdAt: at(2) }),
      item({ name: "Steak", kind: "food", course: 2, createdAt: at(15), sentAt: at(16), status: "started", servedAt: null }),
      item({ name: "Cod", kind: "food", course: 2, createdAt: at(15), sentAt: at(16), status: "started", servedAt: null }),
    ];
    expect(kinds(coachTable(table({ items }), B, at(20)))).toContain("wine_with_mains");
    const withWine = [...items, item({ name: "Rioja", kind: "wine", course: 0, createdAt: at(16) })];
    expect(kinds(coachTable(table({ items: withWine }), B, at(20)))).not.toContain("wine_with_mains");
  });

  it("suggests starters right after a mains-only order", () => {
    const items = [item({ name: "Steak", kind: "food", course: 2, createdAt: at(10), status: "held", sentAt: null, servedAt: null })];
    const r = coachTable(table({ items }), B, at(12));
    expect(kinds(r)).toContain("suggest_starters");
    expect(kinds(coachTable(table({ items }), B, at(20)))).not.toContain("suggest_starters"); // moment passed
  });

  it("offers dessert 10 minutes after mains, then coffee", () => {
    const r = coachTable(table({ items: meal("mains") }), B, at(63));
    expect(r.stage).toBe("dessert");
    expect(kinds(r)).toContain("dessert");
    expect(kinds(r)).not.toContain("coffee");
    // No dessert ordered: coffee 20 minutes after mains.
    expect(kinds(coachTable(table({ items: meal("mains") }), B, at(73)))).toContain("coffee");
    // Dessert eaten: coffee 6 minutes later.
    const after = coachTable(table({ items: meal("dessert") }), B, at(85));
    expect(after.stage).toBe("finishing");
    expect(kinds(after)).toEqual(expect.arrayContaining(["coffee"]));
    expect(kinds(after)).not.toContain("dessert");
  });
});

describe("turns", () => {
  const mealDone = [
    item({ name: "Spritz", kind: "drink", course: 0, createdAt: at(3) }),
    item({ name: "Steak", kind: "food", course: 2, createdAt: at(10), sentAt: at(12), servedAt: at(30) }),
  ];

  it("switches from selling to closing when the next booking is close", () => {
    const relaxed = coachTable(table({ items: mealDone }), B, at(55));
    expect(kinds(relaxed)).toContain("dessert");
    const tight = coachTable(table({ items: mealDone, nextBooking: { start: at(70), covers: 4, name: "Lee" } }), B, at(55));
    expect(tight.mustTurn).toBe(true);
    expect(tight.nudges[0]).toMatchObject({ kind: "turn", priority: 1, title: "Next booking in 15 min" });
    expect(kinds(tight)).not.toContain("dessert");
    expect(kinds(tight)).not.toContain("coffee");
    expect(tight.nudges[0]!.detail).toContain("Bring the bill");
  });

  it("only cares about overrunning when someone else needs the table", () => {
    const free = coachTable(table({ items: mealDone, plannedEnd: at(50) }), B, at(60));
    expect(kinds(free)).not.toContain("overrun");
    const later = coachTable(table({ items: mealDone, plannedEnd: at(50), nextBooking: { start: at(120), covers: 2, name: "Bo" } }), B, at(60));
    expect(kinds(later)).toContain("overrun");
  });
});

describe("pace and projection", () => {
  it("compares spend per head to the benchmark and projects the bill", () => {
    const items = [
      item({ name: "Water", kind: "drink", course: 0, createdAt: at(2), value: 400 }),
      item({ name: "Salad", kind: "food", course: 2, createdAt: at(10), value: 1200, sentAt: at(11), status: "started", servedAt: null }),
    ];
    const r = coachTable(table({ items }), B, at(45));
    expect(r.spendPerHead).toBe(800);
    expect(r.expectedPerHead).toBe(2900);
    expect(r.pace).toBeCloseTo(0.276, 2);
    expect(kinds(r)).toContain("behind_pace");
    // Spent 16.00 + (48.00 − 29.00) × 2 still to come.
    expect(r.projectedTotal).toBe(1600 + 3800);
  });

  it("ranks tables: urgent first, then money on the table", () => {
    const now = at(30);
    const quiet = { id: "q", result: coachTable(table({ items: [item({ name: "Spritz", kind: "drink", course: 0, createdAt: at(1) }), item({ name: "S", kind: "food", course: 2, createdAt: at(5), status: "started", servedAt: null })] }), B, now) };
    const thirsty = { id: "t", result: coachTable(table({ openedAt: at(20) }), B, now) };
    const big = { id: "b", result: coachTable(table({ covers: 8, items: [item({ name: "Spritz", kind: "drink", course: 0, createdAt: at(1) }), item({ name: "S", kind: "food", course: 2, createdAt: at(5), status: "started", servedAt: null })] }), B, now) };
    expect(rankTables([quiet, big, thirsty]).map((x) => x.id)).toEqual(["t", "b", "q"]);
  });
});
