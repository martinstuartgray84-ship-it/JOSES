import { describe, expect, it } from "vitest";
import {
  allDay,
  itemsToSendNow,
  nextCourseToFire,
  planTicket,
  sequenceTickets,
  summariseCourses,
  type KitchenItem,
  type KitchenTicket,
} from "./sequencing";

const T0 = new Date("2026-10-09T18:00:00Z");
const at = (min: number) => new Date(T0.getTime() + min * 60_000);

const item = (name: string, prepMinutes: number, extra: Partial<KitchenItem> = {}): KitchenItem => ({
  id: name,
  name,
  quantity: 1,
  prepMinutes,
  status: "sent",
  ...extra,
});

const ticket = (id: string, firedMin: number, items: KitchenItem[], extra: Partial<KitchenTicket> = {}): KitchenTicket => ({
  id,
  number: Number(id.replace(/\D/g, "")) || 1,
  station: "kitchen",
  course: 2,
  firedAt: at(firedMin),
  tableLabel: `T${id}`,
  items,
  ...extra,
});

describe("planTicket: cook to sync", () => {
  it("staggers starts so everything finishes together", () => {
    const p = planTicket(ticket("1", 0, [item("Salad", 4), item("Ribeye", 14), item("Fries", 6)]), at(0));
    expect(p.target).toEqual(at(14));
    expect(p.items.map((i) => [i.name, i.startInMinutes])).toEqual([
      ["Ribeye", 0],
      ["Fries", 8],
      ["Salad", 10],
    ]);
    expect(p.expectedReady).toEqual(at(14));
    expect(p.lateByMinutes).toBe(0);
    expect(p.urgency).toBe("ok");
  });

  it("projects lateness when the long item starts late", () => {
    const p = planTicket(ticket("1", 0, [item("Salad", 4), item("Ribeye", 14)]), at(5));
    expect(p.items[0]).toMatchObject({ name: "Ribeye", startInMinutes: -5 });
    expect(p.expectedReady).toEqual(at(19));
    expect(p.lateByMinutes).toBe(5);
    expect(p.urgency).toBe("late");
  });

  it("uses actual start times once cooking", () => {
    const p = planTicket(
      ticket("1", 0, [item("Ribeye", 14, { status: "started", startedAt: at(1) }), item("Salad", 4)]),
      at(3),
    );
    expect(p.items.find((i) => i.name === "Ribeye")!.expectedReady).toEqual(at(15));
    expect(p.lateByMinutes).toBe(1);
  });

  it("turns amber at 75% of target time and red past it", () => {
    const t = ticket("1", 0, [item("Pasta", 12, { status: "started", startedAt: at(0) })]);
    expect(planTicket(t, at(8)).urgency).toBe("ok");
    expect(planTicket(t, at(9)).urgency).toBe("warn");
    expect(planTicket(t, at(12)).urgency).toBe("late");
  });

  it("is done when every item is ready, and ignores voided and held items", () => {
    const p = planTicket(
      ticket("1", 0, [
        item("Soup", 5, { status: "ready", readyAt: at(5) }),
        item("Bread", 2, { status: "void" }),
        item("Cake", 3, { status: "held" }),
      ]),
      at(20),
    );
    expect(p.items.map((i) => i.name)).toEqual(["Soup"]);
    expect(p.done).toBe(true);
    expect(p.urgency).toBe("ok");
  });
});

describe("sequenceTickets", () => {
  it("orders by who must start soonest, not by arrival", () => {
    const now = at(10);
    const tickets = [
      // Arrived first, but only salads: can wait.
      ticket("1", 0, [item("Salad", 4), item("Salad2", 3)]),
      // Arrived later, ribeye must start now.
      ticket("2", 9, [item("Ribeye", 14), item("Salad", 4)]),
      // Arrived last, quick dish due now.
      ticket("3", 10, [item("Soup", 5)]),
    ];
    // Ticket 1's salads should have started at 0 and 1: overdue, so first.
    expect(sequenceTickets(tickets, now).map((t) => t.id)).toEqual(["1", "2", "3"]);
    // With ticket 1 cooking, the ribeye (start by 9) beats the soup (start by 10).
    tickets[0]!.items = tickets[0]!.items.map((i) => ({ ...i, status: "started", startedAt: at(1) }));
    expect(sequenceTickets(tickets, now).map((t) => t.id)).toEqual(["2", "3", "1"]);
  });

  it("puts rush tickets first and finished tickets last, and drops bumped ones", () => {
    const now = at(5);
    const tickets = [
      ticket("1", 0, [item("Soup", 5)]),
      ticket("2", 4, [item("Cake", 3)], { priority: true }),
      ticket("3", 0, [item("Bread", 2, { status: "ready", readyAt: at(2) })]),
      ticket("4", 0, [item("Fish", 9)], { bumpedAt: at(4) }),
    ];
    expect(sequenceTickets(tickets, now).map((t) => t.id)).toEqual(["2", "1", "3"]);
  });
});

describe("allDay", () => {
  it("counts waiting and cooking portions across open tickets", () => {
    const counts = allDay([
      ticket("1", 0, [item("Burger", 10, { quantity: 2 }), item("Fries", 5)]),
      ticket("2", 0, [item("Burger", 10, { status: "started" }), item("Salad", 4, { status: "ready" })]),
      ticket("3", 0, [item("Burger", 10)], { bumpedAt: at(1) }),
    ]);
    expect(counts).toEqual([
      { name: "Burger", waiting: 2, cooking: 1 },
      { name: "Fries", waiting: 1, cooking: 0 },
    ]);
  });
});

describe("courses", () => {
  const ci = (course: number, status: KitchenItem["status"], prepMinutes = 10) => ({ course, status, prepMinutes });

  it("summarises each course and suggests the next one to fire", () => {
    const courses = summariseCourses([
      ci(0, "served"),
      ci(1, "served"),
      ci(1, "served"),
      ci(2, "held", 14),
      ci(2, "held", 8),
      ci(3, "held", 4),
      ci(2, "void"),
    ]);
    expect(courses.map((c) => [c.course, c.state, c.items, c.needsMinutes])).toEqual([
      [0, "served", 1, 0],
      [1, "served", 2, 0],
      [2, "held", 2, 14],
      [3, "held", 1, 4],
    ]);
    expect(nextCourseToFire(courses)?.course).toBe(2);
  });

  it("doesn't prompt to fire while an earlier course is still cooking", () => {
    const courses = summariseCourses([ci(1, "started"), ci(2, "held")]);
    expect(courses.map((c) => c.state)).toEqual(["cooking", "held"]);
    expect(nextCourseToFire(courses)).toBeNull();
  });

  it("sends drinks and fired courses now, holds the rest", () => {
    const items = [
      { id: "wine", course: 0, status: "held" as const },
      { id: "soup", course: 1, status: "held" as const },
      { id: "steak", course: 2, status: "held" as const },
      { id: "old", course: 1, status: "sent" as const },
    ];
    expect(itemsToSendNow(items, 1).map((i) => i.id)).toEqual(["wine", "soup"]);
    expect(itemsToSendNow(items, 0).map((i) => i.id)).toEqual(["wine"]);
  });
});
