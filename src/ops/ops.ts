// Operations planning: covers forecast, staffing, prep list, pre-batching and
// live station load. Pure; the server supplies bookings and history.

export interface HourForecast {
  hour: number;
  /** Booked covers arriving this hour, after expected no-shows. */
  booked: number;
  /** Walk-in covers usually arriving this hour on this weekday. */
  walkIns: number;
  arrivals: number;
  /** Guests seated during this hour (arrivals still within their dwell). */
  inHouse: number;
}

export interface ForecastInput {
  /** Booked arrivals: local hour and covers. Arrived bookings aren't discounted for no-shows. */
  bookings: { hour: number; covers: number; arrived?: boolean }[];
  /** Usual walk-in covers per local hour for this weekday. */
  walkInsByHour: Record<number, number>;
  noShowRate: number;
  /** Median minutes from seated to paid. */
  dwellMinutes: number;
  /** Hours the site is open for arrivals. */
  openHours: number[];
}

export function forecastCovers(input: ForecastInput): HourForecast[] {
  const hours = [...new Set([...input.openHours, ...input.bookings.map((b) => b.hour)])].sort((a, b) => a - b);
  if (hours.length === 0) return [];
  const showRate = 1 - Math.min(1, Math.max(0, input.noShowRate));
  const arrivals = new Map<number, { booked: number; walkIns: number }>();
  for (const h of hours) arrivals.set(h, { booked: 0, walkIns: input.walkInsByHour[h] ?? 0 });
  for (const b of input.bookings) arrivals.get(b.hour)!.booked += b.covers * (b.arrived ? 1 : showRate);
  // Guests stay for the dwell time: an arrival at the half-hour fills this hour
  // and the next (dwell / 60) hours, the last partially.
  const stay = Math.max(0.5, input.dwellMinutes / 60);
  const last = Math.max(...hours) + Math.ceil(stay);
  const out: HourForecast[] = [];
  for (let h = Math.min(...hours); h <= last; h++) {
    const a = arrivals.get(h) ?? { booked: 0, walkIns: 0 };
    let inHouse = 0;
    for (const [ah, v] of arrivals) {
      const overlap = Math.max(0, Math.min(h + 1, ah + 0.5 + stay) - Math.max(h, ah + 0.5));
      inHouse += (v.booked + v.walkIns) * overlap;
    }
    out.push({ hour: h, booked: round1(a.booked), walkIns: round1(a.walkIns), arrivals: round1(a.booked + a.walkIns), inHouse: round1(inHouse) });
  }
  // Trim trailing empty hours.
  while (out.length && out[out.length - 1]!.inHouse === 0 && out[out.length - 1]!.arrivals === 0) out.pop();
  return out;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export interface StaffingRatios {
  /** Guests one server can look after well at once. */
  coversPerServer: number;
  /** Drinks one bartender makes in an hour. */
  drinksPerBartenderHour: number;
  /** Plates one cook turns out in an hour. */
  platesPerCookHour: number;
  /** Minimum on shift whenever open. */
  minimum: { servers: number; bar: number; kitchen: number };
}

export const DEFAULT_RATIOS: StaffingRatios = {
  coversPerServer: 16,
  drinksPerBartenderHour: 45,
  platesPerCookHour: 22,
  minimum: { servers: 1, bar: 1, kitchen: 1 },
};

export interface StaffingHour {
  hour: number;
  inHouse: number;
  drinks: number;
  plates: number;
  servers: number;
  bar: number;
  kitchen: number;
  /** Which role limits service most this hour. */
  tightest: "servers" | "bar" | "kitchen";
}

/**
 * Staff per role per hour. Drinks scale with guests in the room; plates with
 * arrivals (most food is ordered within the first hour) plus a share of those
 * already seated (desserts, second courses).
 */
export function planStaffing(
  forecast: HourForecast[],
  usage: { drinksPerCoverHour: number; platesPerCover: number },
  ratios: StaffingRatios = DEFAULT_RATIOS,
): StaffingHour[] {
  return forecast.map((f) => {
    const drinks = f.inHouse * usage.drinksPerCoverHour;
    const plates = f.arrivals * usage.platesPerCover * 0.7 + Math.max(0, f.inHouse - f.arrivals) * usage.platesPerCover * 0.3;
    const need = {
      servers: f.inHouse / ratios.coversPerServer,
      bar: drinks / ratios.drinksPerBartenderHour,
      kitchen: plates / ratios.platesPerCookHour,
    };
    const open = f.inHouse > 0 || f.arrivals > 0;
    const staff = (k: keyof typeof need) => (open ? Math.max(ratios.minimum[k], Math.ceil(need[k] - 0.05)) : 0);
    const tightest = (Object.keys(need) as (keyof typeof need)[]).sort((a, b) => need[b] / Math.max(1, staff(b)) - need[a] / Math.max(1, staff(a)))[0]!;
    return {
      hour: f.hour,
      inHouse: f.inHouse,
      drinks: Math.round(drinks),
      plates: Math.round(plates),
      servers: staff("servers"),
      bar: staff("bar"),
      kitchen: staff("kitchen"),
      tightest,
    };
  });
}

export interface PrepLine {
  name: string;
  /** Expected portions. */
  expected: number;
  /** Prep this many (expected plus buffer, minus stock on hand, rounded up). */
  prep: number;
}

/** Portions to prep: expected covers × usual mix per cover, plus a safety buffer. */
export function prepList(
  expectedCovers: number,
  mixPerCover: { name: string; perCover: number }[],
  opts: { buffer?: number; onHand?: Record<string, number>; minPerCover?: number } = {},
): PrepLine[] {
  const buffer = opts.buffer ?? 0.15;
  return mixPerCover
    .filter((m) => m.perCover >= (opts.minPerCover ?? 0.01))
    .map((m) => {
      const expected = expectedCovers * m.perCover;
      const prep = Math.max(0, Math.ceil(expected * (1 + buffer) - (opts.onHand?.[m.name] ?? 0)));
      return { name: m.name, expected: round1(expected), prep };
    })
    .sort((a, b) => b.expected - a.expected);
}

/** Cocktails worth batching before the peak: expected in the busiest hour. */
export function preBatch(peakInHouse: number, drinksPerCoverHour: number, cocktailMix: { name: string; share: number }[], minimum = 6) {
  const drinks = peakInHouse * drinksPerCoverHour;
  return cocktailMix
    .map((c) => ({ name: c.name, expected: Math.round(drinks * c.share) }))
    .filter((c) => c.expected >= minimum)
    .sort((a, b) => b.expected - a.expected);
}

// ---------------------------------------------------------------------------
// Live load
// ---------------------------------------------------------------------------

export interface QueueItem {
  quantity: number;
  prepMinutes: number;
  status: "sent" | "started";
  sentAt: Date;
}

export interface StationLoad {
  items: number;
  waiting: number;
  cooking: number;
  /** Total cooking minutes still to do (quantities × prep, half for items under way). */
  queuedMinutes: number;
  /** Minutes until the queue clears with this many hands working in parallel. */
  clearsInMinutes: number;
  oldestWaitMinutes: number;
  level: "ok" | "busy" | "overloaded";
}

export function stationLoad(queue: QueueItem[], hands: number, now: Date): StationLoad {
  const items = queue.reduce((n, i) => n + i.quantity, 0);
  const queued = queue.reduce((n, i) => n + i.quantity * i.prepMinutes * (i.status === "started" ? 0.5 : 1), 0);
  const waitingItems = queue.filter((i) => i.status === "sent");
  const oldest = waitingItems.length ? Math.max(...waitingItems.map((i) => (now.getTime() - i.sentAt.getTime()) / 60_000)) : 0;
  // Each hand works through a few items at once on a busy line.
  const parallel = Math.max(1, hands) * 3;
  const clears = queued / parallel;
  const level = clears > 20 || oldest > 15 ? "overloaded" : clears > 10 || oldest > 8 ? "busy" : "ok";
  return {
    items,
    waiting: waitingItems.reduce((n, i) => n + i.quantity, 0),
    cooking: queue.filter((i) => i.status === "started").reduce((n, i) => n + i.quantity, 0),
    queuedMinutes: Math.round(queued),
    clearsInMinutes: Math.round(clears),
    oldestWaitMinutes: Math.round(oldest),
    level,
  };
}

export interface ServerLoad {
  name: string;
  tables: number;
  covers: number;
  urgent: number;
  level: "ok" | "busy" | "overloaded";
}

export function serverLoads(
  tables: { server: string | null; covers: number; urgent: number }[],
  ratios: StaffingRatios = DEFAULT_RATIOS,
): ServerLoad[] {
  const by = new Map<string, ServerLoad>();
  for (const t of tables) {
    const name = t.server ?? "Unassigned";
    const s = by.get(name) ?? { name, tables: 0, covers: 0, urgent: 0, level: "ok" as const };
    s.tables++;
    s.covers += t.covers;
    s.urgent += t.urgent;
    by.set(name, s);
  }
  return [...by.values()]
    .map((s) => ({
      ...s,
      level: (s.covers > ratios.coversPerServer * 1.25 || s.urgent >= 3
        ? "overloaded"
        : s.covers > ratios.coversPerServer || s.urgent >= 2
          ? "busy"
          : "ok") as ServerLoad["level"],
    }))
    .sort((a, b) => b.covers - a.covers);
}

// ---------------------------------------------------------------------------
// Alerts: what to change right now
// ---------------------------------------------------------------------------

export interface StationNow extends StationLoad {
  code: string;
  name: string;
  kind: "kitchen" | "bar" | "pass";
  /** Items ready at this station and not yet taken to the table. */
  readyWaiting: number;
  oldestReadyMinutes: number;
}

export interface OpsAlert {
  area: "kitchen" | "bar" | "floor" | "door";
  severity: 1 | 2;
  title: string;
  detail: string;
}

/** Ready items sitting this long need a runner. */
export const PICKUP_MINUTES = { bar: 3, kitchen: 2, pass: 2 } as const;

/**
 * Turns live load into instructions: who should help whom, when to hold
 * fires, which section takes the next table, and arrivals the door should
 * spread out.
 */
export function opsAlerts(input: {
  stations: StationNow[];
  servers: ServerLoad[];
  /** Booked covers arriving in the next 30 minutes. */
  arrivingSoon: number;
  /** Tables whose mains are due to be fired (from the coach). */
  mainsDue: number;
}): OpsAlert[] {
  const out: OpsAlert[] = [];
  for (const s of input.stations) {
    const area = s.kind === "bar" ? "bar" : "kitchen";
    if (s.level !== "ok") {
      const fix =
        s.kind === "bar"
          ? "Pull a server onto service bar, and hold rounds on tables that are still drinking."
          : input.mainsDue > 0
            ? `Stagger the ${input.mainsDue} mains due to fire: one table every 3–4 min.`
            : "Move a hand from the quietest section; hold non-urgent fires.";
      out.push({
        area,
        severity: s.level === "overloaded" ? 1 : 2,
        title: `${s.name} ${s.level === "overloaded" ? "overloaded" : "busy"}`,
        detail: `${s.waiting + s.cooking} on, clears in ~${s.clearsInMinutes} min, oldest waiting ${s.oldestWaitMinutes} min. ${fix}`,
      });
    }
    const limit = PICKUP_MINUTES[s.kind];
    if (s.readyWaiting > 0 && s.oldestReadyMinutes >= limit) {
      out.push({
        area: s.kind === "bar" ? "bar" : "floor",
        severity: s.oldestReadyMinutes >= limit * 2 ? 1 : 2,
        title: s.kind === "bar" ? `${s.readyWaiting} drinks waiting at the bar` : `${s.readyWaiting} plates waiting on the ${s.name.toLowerCase()}`,
        detail: `Ready ${s.oldestReadyMinutes} min ago. Whoever is nearest runs them, any section.`,
      });
    }
  }
  const named = input.servers.filter((s) => s.name !== "Unassigned");
  const score = (s: ServerLoad) => s.covers + s.urgent * 4;
  const sorted = [...named].sort((a, b) => score(a) - score(b));
  const lightest = sorted[0];
  const heaviest = sorted[sorted.length - 1];
  for (const s of named.filter((x) => x.level !== "ok")) {
    // The least-loaded colleague who isn't drowning themselves.
    const help = sorted.find((h) => h.name !== s.name && h.level !== "overloaded" && score(h) < score(s)) ?? null;
    out.push({
      area: "floor",
      severity: s.level === "overloaded" ? 1 : 2,
      title: `${s.name} has ${s.covers} guests${s.urgent ? `, ${s.urgent} things overdue` : ""}`,
      detail: help
        ? `${help.name} (${help.covers} guests) picks up ${s.name}'s overdue tables, and seats the next table.`
        : "Manager or host covers the overdue tables.",
    });
  }
  if (lightest && heaviest && heaviest.covers - lightest.covers >= 10 && !out.some((a) => a.area === "floor" && a.title.startsWith(heaviest.name))) {
    out.push({
      area: "floor",
      severity: 2,
      title: "Sections are uneven",
      detail: `Seat the next tables with ${lightest.name} (${lightest.covers} guests) before ${heaviest.name} (${heaviest.covers}).`,
    });
  }
  const unassigned = input.servers.find((s) => s.name === "Unassigned");
  if (unassigned && unassigned.tables > 0) {
    out.push({
      area: "floor",
      severity: 2,
      title: `${unassigned.tables} table${unassigned.tables === 1 ? "" : "s"} with no server`,
      detail: lightest ? `Give them to ${lightest.name}.` : "Assign a server on the till.",
    });
  }
  const kitchenBusy = input.stations.some((s) => s.kind === "kitchen" && s.level !== "ok");
  if (input.arrivingSoon >= 12) {
    out.push({
      area: "door",
      severity: kitchenBusy ? 1 : 2,
      title: `${input.arrivingSoon} booked guests in the next 30 min`,
      detail: kitchenBusy
        ? "Kitchen is already busy: seat them a few minutes apart, drinks first, and hold walk-ins at the bar."
        : "Get a round of drinks in fast and take food orders in seating order.",
    });
  }
  return out.sort((a, b) => a.severity - b.severity);
}
