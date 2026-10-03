// Table coach: what's happening at each table, what's been missed, and what
// it's worth. Pure; the caller supplies the table, history-based benchmarks
// and "now".
//
// The goal is revenue per available seat-hour (RevPASH): a table earns more by
// spending more while seated, or by turning in time for the next party. Upsell
// nudges switch off when the table needs to turn.

export type ItemKind = "drink" | "wine" | "hot" | "food";
export type ItemStatus = "held" | "sent" | "started" | "ready" | "served" | "void";

export interface CoachItem {
  name: string;
  kind: ItemKind;
  /** 0 drinks, 1 starters, 2 mains, 3 desserts. */
  course: number;
  quantity: number;
  status: ItemStatus;
  createdAt: Date;
  sentAt?: Date | null;
  servedAt?: Date | null;
  /** Line value in pence (0 if comped). */
  value: number;
}

export interface CoachTable {
  tableId: string | null;
  label: string;
  seats: number;
  covers: number;
  openedAt: Date;
  /** When the booking (or turn time) says they should be finishing. */
  plannedEnd?: Date | null;
  /** The next booking on this table, if any. */
  nextBooking?: { start: Date; covers: number; name: string } | null;
  items: CoachItem[];
  guest?: { name: string; visits: number; favouriteDrink?: string | null; favouriteDessert?: string | null; allergies?: string | null } | null;
  daypart: "lunch" | "dinner";
}

/** What tables like this usually do, from the site's own history. */
export interface Benchmark {
  /** Median cumulative spend per head (pence) at minutes since seated: [[15, 820], [30, 1650], ...]. */
  spendCurve: [number, number][];
  /** Median final spend per head (pence). */
  finalPerHead: number;
  /** Median minutes from seated to paid. */
  dwellMinutes: number;
  /** Average unit prices (pence) for valuing nudges. */
  avgPrice: { drink: number; wine: number; dessert: number; hot: number; starter: number };
  /** Share of guests who take each (0..1), for expected values. */
  attach: { secondRound: number; dessert: number; hot: number; starter: number; wine: number };
}

export const DEFAULT_BENCHMARK: Benchmark = {
  spendCurve: [
    [0, 0],
    [15, 900],
    [30, 1700],
    [45, 2900],
    [60, 3600],
    [90, 4400],
    [120, 4800],
  ],
  finalPerHead: 4800,
  dwellMinutes: 100,
  avgPrice: { drink: 750, wine: 3200, dessert: 800, hot: 350, starter: 900 },
  attach: { secondRound: 0.5, dessert: 0.4, hot: 0.3, starter: 0.6, wine: 0.3 },
};

/** Timings that define "missed": tuned for UK casual-to-premium dining. */
export const RULES = {
  firstDrinkMinutes: 4,
  drinkWaitMinutes: 7,
  foodOrderMinutes: 12,
  roundEveryMinutes: { lunch: 30, dinner: 25 },
  fireMainsAfterStartersMinutes: 12,
  dessertAfterMainsMinutes: 10,
  coffeeAfterDessertMinutes: 6,
  coffeeAfterMainsMinutes: 20,
  idleMinutes: 20,
  turnWarnMinutes: 25,
  paceCheckAfterMinutes: 30,
  paceBehindRatio: 0.65,
  /** Group drink lines ordered within this window into one round. */
  roundGapMinutes: 4,
  maxRoundsPerCoverHint: 4,
};

export type Stage = "seated" | "drinks" | "ordered" | "starters" | "mains" | "dessert" | "finishing";

export type NudgeKind =
  | "first_drink"
  | "drinks_waiting"
  | "take_order"
  | "suggest_starters"
  | "wine_with_mains"
  | "fire_mains"
  | "next_round"
  | "dessert"
  | "coffee"
  | "idle"
  | "turn"
  | "overrun"
  | "behind_pace";

export interface Nudge {
  kind: NudgeKind;
  /** 1 = do now (service failing or turn at risk), 2 = sell now, 3 = worth knowing. */
  priority: 1 | 2 | 3;
  title: string;
  detail: string;
  /** Expected extra revenue if acted on (pence), for ranking. */
  value: number;
  /** Minutes it has been due. */
  dueFor: number;
}

export interface TimelineEvent {
  at: Date;
  kind: "seated" | "drinks" | "food_order" | "starters_out" | "mains_fired" | "mains_out" | "dessert" | "hot" | "now" | "planned_end" | "next_booking";
  label: string;
}

export interface CoachResult {
  stage: Stage;
  minutesSeated: number;
  spend: number;
  spendPerHead: number;
  /** Benchmark spend per head at this minute. */
  expectedPerHead: number | null;
  /** spendPerHead ÷ expectedPerHead. */
  pace: number | null;
  projectedTotal: number;
  rounds: number;
  drinksPerCover: number;
  minutesSinceLastOrder: number | null;
  minutesSinceLastDrink: number | null;
  /** Minutes until the next booking on this table, if any. */
  turnInMinutes: number | null;
  mustTurn: boolean;
  timeline: TimelineEvent[];
  nudges: Nudge[];
  /** Total value of open selling nudges (pence). */
  opportunity: number;
}

const MIN = 60_000;
const mins = (a: Date, b: Date) => (a.getTime() - b.getTime()) / MIN;
const live = (i: CoachItem) => i.status !== "void";
const isDrink = (i: CoachItem) => i.kind === "drink" || i.kind === "wine";
const maxDate = (ds: (Date | null | undefined)[]) => {
  const t = ds.filter((d): d is Date => !!d).map((d) => d.getTime());
  return t.length ? new Date(Math.max(...t)) : null;
};
const minDate = (ds: (Date | null | undefined)[]) => {
  const t = ds.filter((d): d is Date => !!d).map((d) => d.getTime());
  return t.length ? new Date(Math.min(...t)) : null;
};

/** Linear interpolation on the benchmark's spend curve. */
export function expectedPerHeadAt(curve: [number, number][], minute: number): number | null {
  if (curve.length === 0) return null;
  const pts = [...curve].sort((a, b) => a[0] - b[0]);
  if (minute <= pts[0]![0]) return pts[0]![1];
  for (let i = 1; i < pts.length; i++) {
    const [x1, y1] = pts[i]!;
    const [x0, y0] = pts[i - 1]!;
    if (minute <= x1) return Math.round(y0 + ((y1 - y0) * (minute - x0)) / (x1 - x0 || 1));
  }
  return pts[pts.length - 1]![1];
}

/** Group drink lines into rounds: orders within a few minutes of each other are one round. */
export function drinkRounds(items: CoachItem[]): Date[] {
  const times = items
    .filter((i) => live(i) && isDrink(i))
    .map((i) => i.createdAt.getTime())
    .sort((a, b) => a - b);
  const rounds: number[] = [];
  for (const t of times) {
    if (!rounds.length || t - rounds[rounds.length - 1]! > RULES.roundGapMinutes * MIN) rounds.push(t);
  }
  return rounds.map((t) => new Date(t));
}

export function coachTable(t: CoachTable, b: Benchmark, now: Date): CoachResult {
  const items = t.items.filter(live);
  const covers = Math.max(1, t.covers);
  const seated = mins(now, t.openedAt);
  const spend = items.reduce((n, i) => n + i.value, 0);
  const spendPerHead = Math.round(spend / covers);

  const drinks = items.filter(isDrink);
  const food = items.filter((i) => i.kind === "food");
  const starters = food.filter((i) => i.course === 1);
  const mains = food.filter((i) => i.course === 2);
  const desserts = food.filter((i) => i.course === 3);
  const hot = items.filter((i) => i.kind === "hot");
  const rounds = drinkRounds(items);

  const firstDrinkAt = minDate(drinks.map((i) => i.createdAt));
  const lastDrinkAt = maxDate(drinks.map((i) => i.createdAt));
  const foodOrderAt = minDate(food.map((i) => i.createdAt));
  const lastOrderAt = maxDate(items.map((i) => i.createdAt));
  const startersOut = starters.length && starters.every((i) => i.status === "served") ? maxDate(starters.map((i) => i.servedAt)) : null;
  const mainsFired = minDate(mains.map((i) => i.sentAt));
  const mainsOut = mains.length && mains.every((i) => i.status === "served") ? maxDate(mains.map((i) => i.servedAt)) : null;
  const dessertOut = desserts.length && desserts.every((i) => i.status === "served") ? maxDate(desserts.map((i) => i.servedAt)) : null;
  const dessertAt = minDate(desserts.map((i) => i.createdAt));
  const hotAt = minDate(hot.map((i) => i.createdAt));

  const stage: Stage = dessertAt || hotAt
    ? "finishing"
    : mainsOut
      ? "dessert"
      : mainsFired
        ? "mains"
        : starters.some((i) => i.status !== "held")
          ? "starters"
          : foodOrderAt
            ? "ordered"
            : drinks.length
              ? "drinks"
              : "seated";

  const turnIn = t.nextBooking ? mins(t.nextBooking.start, now) : null;
  const mustTurn = turnIn !== null && turnIn <= RULES.turnWarnMinutes;
  const overrunBy = t.plannedEnd ? mins(now, t.plannedEnd) : null;

  const expectedPerHead = expectedPerHeadAt(b.spendCurve, seated);
  const pace = expectedPerHead && expectedPerHead > 0 && seated >= 10 ? spendPerHead / expectedPerHead : null;
  // Projection: what's been spent plus what tables like this usually add from here.
  const remainingPerHead = Math.max(0, b.finalPerHead - (expectedPerHead ?? 0));
  const projectedTotal = spend + Math.round(remainingPerHead * covers * (mustTurn ? 0.3 : 1));

  const nudges: Nudge[] = [];
  const add = (n: Nudge) => nudges.push({ ...n, dueFor: Math.max(0, Math.round(n.dueFor)), value: Math.round(n.value) });
  const regularDrink = t.guest?.favouriteDrink;

  // --- Service basics (priority 1)
  if (!drinks.length && seated >= RULES.firstDrinkMinutes && stage !== "finishing") {
    add({
      kind: "first_drink",
      priority: 1,
      title: "No drinks yet",
      detail: `Seated ${Math.round(seated)} min.${regularDrink ? ` ${t.guest!.name} usually has ${regularDrink}.` : ""}`,
      value: covers * b.avgPrice.drink,
      dueFor: seated - RULES.firstDrinkMinutes,
    });
  }
  const waitingDrinks = drinks.filter((i) => i.status !== "served" && i.sentAt && mins(now, i.sentAt) >= RULES.drinkWaitMinutes);
  if (waitingDrinks.length) {
    const oldest = minDate(waitingDrinks.map((i) => i.sentAt))!;
    add({
      kind: "drinks_waiting",
      priority: 1,
      title: "Drinks waiting",
      detail: `${waitingDrinks.reduce((n, i) => n + i.quantity, 0)} drink(s) sent ${Math.round(mins(now, oldest))} min ago, not served.`,
      value: 0,
      dueFor: mins(now, oldest) - RULES.drinkWaitMinutes,
    });
  }
  if (!food.length && seated >= RULES.foodOrderMinutes && !hotAt) {
    add({
      kind: "take_order",
      priority: 1,
      title: "Food order not taken",
      detail: `Seated ${Math.round(seated)} min.`,
      value: covers * (b.finalPerHead - b.avgPrice.drink) * 0.5,
      dueFor: seated - RULES.foodOrderMinutes,
    });
  }
  const mainsHeld = mains.some((i) => i.status === "held");
  if (mainsHeld && startersOut && mins(now, startersOut) >= RULES.fireMainsAfterStartersMinutes) {
    add({
      kind: "fire_mains",
      priority: 1,
      title: "Fire mains",
      detail: `Starters went out ${Math.round(mins(now, startersOut))} min ago.`,
      value: 0,
      dueFor: mins(now, startersOut) - RULES.fireMainsAfterStartersMinutes,
    });
  }

  // --- Turn management (priority 1). When the next party is close, stop selling, start closing.
  if (t.nextBooking && turnIn !== null && turnIn <= RULES.turnWarnMinutes) {
    const left = Math.max(0, Math.round(turnIn));
    add({
      kind: "turn",
      priority: 1,
      title: turnIn <= 0 ? "Next booking is waiting" : `Next booking in ${left} min`,
      detail: `${t.nextBooking.name}, ${t.nextBooking.covers} at ${t.nextBooking.start.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" })}. ${
        stage === "finishing" || stage === "dessert" ? "Bring the bill, or offer coffee at the bar." : "Keep courses moving."
      }`,
      value: t.nextBooking.covers * b.finalPerHead * 0.1,
      dueFor: RULES.turnWarnMinutes - turnIn,
    });
  } else if (overrunBy !== null && overrunBy > 0 && t.nextBooking) {
    // Over time with a later booking on the table: worth keeping an eye on.
    // (Over time with nobody waiting is fine, and a chance to sell more.)
    add({ kind: "overrun", priority: 2, title: `Over time by ${Math.round(overrunBy)} min`, detail: "Planned to have finished.", value: 0, dueFor: overrunBy });
  }

  // --- Selling moments (priority 2), only when there's time to enjoy them.
  if (!mustTurn) {
    if (foodOrderAt && !starters.length && !mainsFired && mins(now, foodOrderAt) <= 6) {
      add({
        kind: "suggest_starters",
        priority: 2,
        title: "No starters",
        detail: "Offer something to share while the kitchen cooks: bread, olives, a starter.",
        value: Math.max(1, Math.round(covers / 2)) * b.avgPrice.starter,
        dueFor: mins(now, foodOrderAt),
      });
    }
    const drinksSinceFood = foodOrderAt ? drinks.filter((i) => i.createdAt >= new Date(foodOrderAt.getTime() - 5 * MIN)) : [];
    const hasWine = drinks.some((i) => i.kind === "wine");
    // Once mains are fired: the moment guests think about what goes with them.
    if (mains.length && mainsFired && !mainsOut && covers >= 2 && !hasWine && drinksSinceFood.length === 0) {
      add({
        kind: "wine_with_mains",
        priority: 2,
        title: "Wine with mains?",
        detail: `${mains.reduce((n, i) => n + i.quantity, 0)} mains on, nothing to drink with them.`,
        value: b.avgPrice.wine * b.attach.wine * 2,
        dueFor: mainsFired ? mins(now, mainsFired) : 0,
      });
    }
    const roundEvery = RULES.roundEveryMinutes[t.daypart];
    const sinceDrink = lastDrinkAt ? mins(now, lastDrinkAt) : null;
    const lastDrinksServed = drinks.length > 0 && drinks.every((i) => i.status === "served");
    if (
      sinceDrink !== null &&
      sinceDrink >= roundEvery &&
      lastDrinksServed &&
      rounds.length / covers < RULES.maxRoundsPerCoverHint &&
      // After mains it's dessert and coffee time, not another round.
      stage !== "finishing" &&
      stage !== "dessert"
    ) {
      add({
        kind: "next_round",
        priority: 2,
        title: "Next round",
        detail: `Last drinks ${Math.round(sinceDrink)} min ago.${regularDrink ? ` ${t.guest!.name} usually has ${regularDrink}.` : ""}`,
        value: covers * b.avgPrice.drink * Math.max(0.4, b.attach.secondRound),
        dueFor: sinceDrink - roundEvery,
      });
    }
    if (mainsOut && !desserts.length && !hot.length && mins(now, mainsOut) >= RULES.dessertAfterMainsMinutes) {
      add({
        kind: "dessert",
        priority: 2,
        title: "Offer desserts",
        detail: `Mains finished ${Math.round(mins(now, mainsOut))} min ago.${t.guest?.favouriteDessert ? ` Usually has ${t.guest.favouriteDessert}.` : ""}`,
        value: covers * b.avgPrice.dessert * Math.max(0.3, b.attach.dessert),
        dueFor: mins(now, mainsOut) - RULES.dessertAfterMainsMinutes,
      });
    }
    const coffeeFrom = dessertOut
      ? new Date(dessertOut.getTime() + RULES.coffeeAfterDessertMinutes * MIN)
      : mainsOut && !desserts.length
        ? new Date(mainsOut.getTime() + RULES.coffeeAfterMainsMinutes * MIN)
        : null;
    if (coffeeFrom && now >= coffeeFrom && !hot.length) {
      add({
        kind: "coffee",
        priority: 2,
        title: "Coffee or a digestif?",
        detail: dessertOut ? "Desserts are done." : "No dessert: offer coffee before the bill.",
        value: covers * b.avgPrice.hot * Math.max(0.3, b.attach.hot),
        dueFor: mins(now, coffeeFrom),
      });
    }
  }

  // Idle: everything served, nothing ordered for a while.
  const allServed = items.length > 0 && items.every((i) => i.status === "served");
  if (allServed && lastOrderAt && mins(now, lastOrderAt) >= RULES.idleMinutes && !nudges.some((n) => n.priority === 1 || n.kind === "dessert" || n.kind === "coffee" || n.kind === "next_round")) {
    add({
      kind: "idle",
      priority: 2,
      title: "Quiet table",
      detail: `Nothing ordered for ${Math.round(mins(now, lastOrderAt))} min. Check in, offer something, or bring the bill.`,
      value: covers * b.avgPrice.drink * 0.3,
      dueFor: mins(now, lastOrderAt) - RULES.idleMinutes,
    });
  }

  if (pace !== null && seated >= RULES.paceCheckAfterMinutes && pace < RULES.paceBehindRatio && !mustTurn) {
    add({
      kind: "behind_pace",
      priority: 3,
      title: "Spending below usual",
      detail: `£${(spendPerHead / 100).toFixed(0)} a head after ${Math.round(seated)} min; tables like this are usually at £${((expectedPerHead ?? 0) / 100).toFixed(0)}.`,
      value: Math.round(((expectedPerHead ?? 0) - spendPerHead) * covers * 0.3),
      dueFor: seated - RULES.paceCheckAfterMinutes,
    });
  }

  // Service problems: longest-waiting first. Selling: most valuable first.
  nudges.sort((x, y) => x.priority - y.priority || (x.priority === 1 ? y.dueFor - x.dueFor : y.value - x.value) || y.dueFor - x.dueFor);

  const timeline: TimelineEvent[] = [{ at: t.openedAt, kind: "seated", label: `Seated ${covers}` }];
  rounds.forEach((r, i) => timeline.push({ at: r, kind: "drinks", label: i === 0 ? "First drinks" : `Round ${i + 1}` }));
  if (foodOrderAt) timeline.push({ at: foodOrderAt, kind: "food_order", label: "Food ordered" });
  if (startersOut) timeline.push({ at: startersOut, kind: "starters_out", label: "Starters out" });
  if (mainsFired) timeline.push({ at: mainsFired, kind: "mains_fired", label: "Mains fired" });
  if (mainsOut) timeline.push({ at: mainsOut, kind: "mains_out", label: "Mains out" });
  if (dessertAt) timeline.push({ at: dessertAt, kind: "dessert", label: "Desserts" });
  if (hotAt) timeline.push({ at: hotAt, kind: "hot", label: "Coffee" });
  if (t.plannedEnd) timeline.push({ at: t.plannedEnd, kind: "planned_end", label: "Planned end" });
  if (t.nextBooking) timeline.push({ at: t.nextBooking.start, kind: "next_booking", label: `Next: ${t.nextBooking.name}` });
  timeline.push({ at: now, kind: "now", label: "Now" });
  timeline.sort((x, y) => x.at.getTime() - y.at.getTime());

  return {
    stage,
    minutesSeated: Math.round(seated),
    spend,
    spendPerHead,
    expectedPerHead,
    pace,
    projectedTotal,
    rounds: rounds.length,
    drinksPerCover: Math.round((drinks.reduce((n, i) => n + i.quantity, 0) / covers) * 10) / 10,
    minutesSinceLastOrder: lastOrderAt ? Math.round(mins(now, lastOrderAt)) : null,
    minutesSinceLastDrink: lastDrinkAt ? Math.round(mins(now, lastDrinkAt)) : null,
    turnInMinutes: turnIn === null ? null : Math.round(turnIn),
    mustTurn,
    timeline,
    nudges,
    opportunity: nudges.filter((n) => n.priority === 2).reduce((s, n) => s + n.value, 0),
  };
}

/** Rank tables for the floor manager: most urgent first, then most money on the table. */
export function rankTables<T extends { result: CoachResult }>(tables: T[]): T[] {
  const score = (r: CoachResult) => {
    const top = r.nudges[0];
    if (!top) return 0;
    return (4 - top.priority) * 1_000_000 + Math.min(999_999, r.opportunity + top.dueFor * 100);
  };
  return [...tables].sort((a, b) => score(b.result) - score(a.result));
}

/** Classify an item from its course and category name. */
export function itemKind(course: number, categoryName: string | null | undefined): ItemKind {
  const c = (categoryName ?? "").toLowerCase();
  if (/(coffee|tea|hot drink|espresso|digestif)/.test(c)) return "hot";
  if (course !== 0) return "food";
  if (/(wine|fizz|champagne|sparkling|bubbles|prosecco)/.test(c)) return "wine";
  return "drink";
}
