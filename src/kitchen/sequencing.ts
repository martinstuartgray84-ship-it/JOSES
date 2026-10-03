// Kitchen sequencing. Pure functions: the caller passes tickets and "now".
//
// "Cook to sync": a ticket should leave the pass all at once. Its target time is
// when it was fired plus its longest item. Every item gets a start-by time
// (target minus its own prep), so the steak starts now and the salad waits.
// Station screens order tickets by who needs to start soonest, not by arrival.

export type KitchenItemStatus = "held" | "sent" | "started" | "ready" | "served" | "void";

export interface KitchenItem {
  id: string;
  name: string;
  quantity: number;
  prepMinutes: number;
  status: KitchenItemStatus;
  startedAt?: Date | null;
  readyAt?: Date | null;
  /** Free text shown under the item: modifiers and notes. */
  detail?: string;
  seat?: number | null;
}

export interface KitchenTicket {
  id: string;
  number: number;
  station: string;
  course: number;
  firedAt: Date;
  bumpedAt?: Date | null;
  priority?: boolean;
  tableLabel: string;
  covers?: number;
  items: KitchenItem[];
}

export type Urgency = "ok" | "warn" | "late";

export interface PlannedItem extends KitchenItem {
  /** When this item must start so the ticket finishes together. */
  startBy: Date;
  /** Minutes until startBy (negative = should already have started). Null once started. */
  startInMinutes: number | null;
  /** When this item will be ready, at the latest of now/startBy plus prep. */
  expectedReady: Date;
}

export interface PlannedTicket extends Omit<KitchenTicket, "items"> {
  items: PlannedItem[];
  /** Fired time plus the longest prep on the ticket. */
  target: Date;
  /** Best estimate of when the whole ticket will be ready. */
  expectedReady: Date;
  /** Minutes past target expected (0 if on time). */
  lateByMinutes: number;
  elapsedMinutes: number;
  /** Share of the target time already used, 0..∞. */
  progress: number;
  urgency: Urgency;
  /** Earliest start-by among items not yet started; null if all started. */
  nextStartBy: Date | null;
  done: boolean;
}

const MIN = 60_000;
const addMin = (d: Date, m: number) => new Date(d.getTime() + m * MIN);
const diffMin = (a: Date, b: Date) => (a.getTime() - b.getTime()) / MIN;
const live = (i: KitchenItem) => i.status !== "void" && i.status !== "held";

/** Amber once 75% of the target time is used, red when past target or projected late. */
export const WARN_AT = 0.75;

export function planTicket(ticket: KitchenTicket, now: Date): PlannedTicket {
  const items = ticket.items.filter(live);
  const longest = Math.max(0, ...items.map((i) => i.prepMinutes));
  const target = addMin(ticket.firedAt, longest);

  const planned: PlannedItem[] = items.map((i) => {
    const startBy = addMin(target, -i.prepMinutes);
    if (i.status === "ready" || i.status === "served") {
      const readyAt = i.readyAt ?? now;
      return { ...i, startBy, startInMinutes: null, expectedReady: readyAt };
    }
    if (i.status === "started") {
      const startedAt = i.startedAt ?? now;
      const finish = addMin(startedAt, i.prepMinutes);
      // Running over its own prep time: assume it's nearly there, not done in the past.
      return { ...i, startBy, startInMinutes: null, expectedReady: finish < now ? now : finish };
    }
    const startAt = startBy > now ? startBy : now;
    return {
      ...i,
      startBy,
      startInMinutes: Math.round(diffMin(startBy, now)),
      expectedReady: addMin(startAt, i.prepMinutes),
    };
  });

  const done = planned.length > 0 && planned.every((i) => i.status === "ready" || i.status === "served");
  const expectedReady = planned.length
    ? new Date(Math.max(...planned.map((i) => i.expectedReady.getTime())))
    : ticket.firedAt;
  const lateByMinutes = Math.max(0, Math.round(diffMin(expectedReady, target)));
  const elapsedMinutes = Math.max(0, diffMin(ticket.bumpedAt ?? now, ticket.firedAt));
  const progress = longest === 0 ? (done ? 0 : 1) : elapsedMinutes / longest;
  const waiting = planned.filter((i) => i.startInMinutes !== null);
  const nextStartBy = waiting.length ? new Date(Math.min(...waiting.map((i) => i.startBy.getTime()))) : null;

  const urgency: Urgency = done
    ? "ok"
    : progress >= 1 || lateByMinutes > 0
      ? "late"
      : progress >= WARN_AT
        ? "warn"
        : "ok";

  return {
    ...ticket,
    items: planned.sort(
      (a, b) => a.startBy.getTime() - b.startBy.getTime() || b.prepMinutes - a.prepMinutes || a.name.localeCompare(b.name),
    ),
    target,
    expectedReady,
    lateByMinutes,
    elapsedMinutes,
    progress,
    urgency,
    nextStartBy,
    done,
  };
}

/**
 * Order a station's open tickets: rush first, then whoever must start soonest,
 * then those already cooking by how late they'll be, then arrival. Finished
 * tickets go last (they're waiting for the bump).
 */
export function sequenceTickets(tickets: KitchenTicket[], now: Date): PlannedTicket[] {
  return tickets
    .filter((t) => !t.bumpedAt)
    .map((t) => planTicket(t, now))
    .filter((t) => t.items.length > 0)
    .sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1;
      if (!!a.priority !== !!b.priority) return a.priority ? -1 : 1;
      const an = a.nextStartBy?.getTime() ?? Infinity;
      const bn = b.nextStartBy?.getTime() ?? Infinity;
      if (an !== bn) return an - bn;
      if (a.lateByMinutes !== b.lateByMinutes) return b.lateByMinutes - a.lateByMinutes;
      return a.firedAt.getTime() - b.firedAt.getTime() || a.number - b.number;
    });
}

export interface AllDayCount {
  name: string;
  /** Not started yet. */
  waiting: number;
  /** On the go. */
  cooking: number;
}

/** "All day" counts across open tickets, so a section can batch the same dish. */
export function allDay(tickets: KitchenTicket[]): AllDayCount[] {
  const counts = new Map<string, AllDayCount>();
  for (const t of tickets) {
    if (t.bumpedAt) continue;
    for (const i of t.items) {
      if (i.status !== "sent" && i.status !== "started") continue;
      const c = counts.get(i.name) ?? { name: i.name, waiting: 0, cooking: 0 };
      if (i.status === "sent") c.waiting += i.quantity;
      else c.cooking += i.quantity;
      counts.set(i.name, c);
    }
  }
  return [...counts.values()].sort(
    (a, b) => b.waiting + b.cooking - (a.waiting + a.cooking) || a.name.localeCompare(b.name),
  );
}

// ---------------------------------------------------------------------------
// Courses on a table
// ---------------------------------------------------------------------------

export interface CourseItem {
  course: number;
  status: KitchenItemStatus;
  prepMinutes: number;
  sentAt?: Date | null;
  servedAt?: Date | null;
}

export type CourseState = "held" | "cooking" | "ready" | "served";

export interface CourseSummary {
  course: number;
  state: CourseState;
  items: number;
  /** For held courses: minutes the kitchen needs once fired (longest prep). */
  needsMinutes: number;
  sentAt: Date | null;
  servedAt: Date | null;
}

export function summariseCourses(items: CourseItem[]): CourseSummary[] {
  const byCourse = new Map<number, CourseItem[]>();
  for (const i of items) {
    if (i.status === "void") continue;
    byCourse.set(i.course, [...(byCourse.get(i.course) ?? []), i]);
  }
  return [...byCourse.entries()]
    .sort(([a], [b]) => a - b)
    .map(([course, list]) => {
      const all = (s: KitchenItemStatus[]) => list.every((i) => s.includes(i.status));
      const state: CourseState = all(["served"])
        ? "served"
        : all(["ready", "served"])
          ? "ready"
          : list.some((i) => i.status === "held")
            ? list.every((i) => i.status === "held")
              ? "held"
              : "cooking"
            : "cooking";
      const times = (k: "sentAt" | "servedAt") =>
        list.map((i) => i[k]).filter((d): d is Date => !!d).map((d) => d.getTime());
      const sent = times("sentAt");
      const served = times("servedAt");
      return {
        course,
        state,
        items: list.length,
        needsMinutes: Math.max(0, ...list.filter((i) => i.status === "held").map((i) => i.prepMinutes)),
        sentAt: sent.length ? new Date(Math.min(...sent)) : null,
        servedAt: state === "served" && served.length ? new Date(Math.max(...served)) : null,
      };
    });
}

/**
 * The next course a server should fire, if any: the lowest held course, once
 * every earlier course has at least been sent. (Firing early is still allowed;
 * this only drives the "ready to fire" prompt.)
 */
export function nextCourseToFire(courses: CourseSummary[]): CourseSummary | null {
  const held = courses.find((c) => c.state === "held");
  if (!held) return null;
  const earlier = courses.filter((c) => c.course < held.course);
  return earlier.every((c) => c.state === "served" || c.state === "ready") ? held : null;
}

/** Items of a send that go to the kitchen straight away: drinks always, plus courses up to `fireUpTo`. */
export function itemsToSendNow<T extends { course: number; status: KitchenItemStatus }>(items: T[], fireUpTo: number): T[] {
  return items.filter((i) => i.status === "held" && (i.course === 0 || i.course <= fireUpTo));
}
