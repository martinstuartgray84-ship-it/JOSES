import type {
  AvailabilityRequest,
  ExistingBooking,
  Minutes,
  Service,
  Slot,
  TableAssignment,
  TableBlock,
  VenueConfig,
} from "./types";

/** Statuses that hold a table. Completed bookings free their table early. */
const OCCUPYING = new Set<ExistingBooking["status"]>(["pending", "confirmed", "seated"]);

/** Statuses that count towards pacing (a no-show still consumed kitchen capacity at that slot). */
const PACED = new Set<ExistingBooking["status"]>([
  "pending",
  "confirmed",
  "seated",
  "completed",
  "no_show",
]);

export function turnTimeFor(service: Service, covers: number): Minutes {
  const sorted = [...service.turnTimes].sort((a, b) => a.maxCovers - b.maxCovers);
  const match = sorted.find((t) => covers <= t.maxCovers) ?? sorted[sorted.length - 1];
  if (!match) throw new Error(`Service ${service.id} has no turn times configured`);
  return match.minutes;
}

const overlaps = (aStart: Minutes, aEnd: Minutes, bStart: Minutes, bEnd: Minutes) =>
  aStart < bEnd && bStart < aEnd;

/**
 * Candidate seating units for a party, best fit first: least wasted seats,
 * then single tables before combinations, then fewest tables, then id for stability.
 */
export function candidateUnits(
  venue: VenueConfig,
  covers: number,
  opts: { channel: "online" | "staff"; areaIds?: string[] },
): TableAssignment[] {
  const tablesById = new Map(venue.tables.map((t) => [t.id, t]));
  const inArea = (tableId: string) => {
    const t = tablesById.get(tableId);
    return !!t && (!opts.areaIds?.length || opts.areaIds.includes(t.areaId));
  };
  const online = opts.channel === "online";

  const units: TableAssignment[] = [];
  for (const t of venue.tables) {
    if (online && !t.bookableOnline) continue;
    if (covers < t.minCovers || covers > t.maxCovers || !inArea(t.id)) continue;
    units.push({ unitId: t.id, tableIds: [t.id], capacity: t.maxCovers, isCombination: false });
  }
  for (const c of venue.combinations) {
    if (online && !c.bookableOnline) continue;
    if (covers < c.minCovers || covers > c.maxCovers) continue;
    if (c.tableIds.length === 0 || !c.tableIds.every(inArea)) continue;
    units.push({ unitId: c.id, tableIds: [...c.tableIds], capacity: c.maxCovers, isCombination: true });
  }

  return units.sort(
    (a, b) =>
      a.capacity - b.capacity ||
      Number(a.isCombination) - Number(b.isCombination) ||
      a.tableIds.length - b.tableIds.length ||
      a.unitId.localeCompare(b.unitId),
  );
}

interface Interval {
  start: Minutes;
  end: Minutes;
}

/** Time each table is unavailable, including the reset buffer after each booking. */
function occupancyByTable(
  bookings: ExistingBooking[],
  blocks: TableBlock[],
  bufferFor: (b: ExistingBooking) => Minutes,
  ignoreBookingId?: string,
): Map<string, Interval[]> {
  const map = new Map<string, Interval[]>();
  const add = (tableId: string, iv: Interval) => {
    const list = map.get(tableId);
    if (list) list.push(iv);
    else map.set(tableId, [iv]);
  };
  for (const b of bookings) {
    if (!OCCUPYING.has(b.status) || b.id === ignoreBookingId) continue;
    const iv = { start: b.start, end: b.start + b.durationMinutes + bufferFor(b) };
    for (const tableId of b.tableIds) add(tableId, iv);
  }
  for (const blk of blocks) add(blk.tableId, { start: blk.start, end: blk.end });
  return map;
}

function unitIsFree(
  unit: TableAssignment,
  occupancy: Map<string, Interval[]>,
  start: Minutes,
  end: Minutes,
): boolean {
  return unit.tableIds.every((id) =>
    (occupancy.get(id) ?? []).every((iv) => !overlaps(start, end, iv.start, iv.end)),
  );
}

/**
 * Every bookable start time for a party on one day, across all services that run that day.
 * Pure: no I/O, no clock. The caller supplies the day's bookings and blocks.
 */
export function getAvailability(req: AvailabilityRequest): Slot[] {
  const { venue, dayOfWeek, covers, bookings } = req;
  const channel = req.channel ?? "online";
  const blocks = req.blocks ?? [];
  const servicesById = new Map(venue.services.map((s) => [s.id, s]));
  const bufferFor = (b: ExistingBooking) => servicesById.get(b.serviceId)?.bufferMinutes ?? 0;
  const occupancy = occupancyByTable(bookings, blocks, bufferFor);

  const slots: Slot[] = [];
  const services = venue.services
    .filter((s) => s.daysOfWeek.includes(dayOfWeek))
    .sort((a, b) => a.firstSeating - b.firstSeating);

  for (const service of services) {
    if (service.slotIntervalMinutes <= 0) {
      throw new Error(`Service ${service.id} must have a positive slot interval`);
    }
    const duration = turnTimeFor(service, covers);
    const sizeOk = covers >= service.minCovers && covers <= service.maxCovers;
    const units = sizeOk ? candidateUnits(venue, covers, { channel, areaIds: service.areaIds }) : [];
    const paced = bookings.filter((b) => b.serviceId === service.id && PACED.has(b.status));

    for (let t = service.firstSeating; t <= service.lastSeating; t += service.slotIntervalMinutes) {
      const base = { serviceId: service.id, time: t, durationMinutes: duration };

      if (!sizeOk) {
        slots.push({ ...base, available: false, reason: "party_size_out_of_range" });
        continue;
      }
      if (req.notBefore !== undefined && t < req.notBefore) {
        slots.push({ ...base, available: false, reason: "too_soon" });
        continue;
      }

      const inSlot = paced.filter((b) => b.start >= t && b.start < t + service.slotIntervalMinutes);
      const { maxCoversPerSlot, maxBookingsPerSlot } = service.pacing ?? {};
      if (maxBookingsPerSlot !== undefined && inSlot.length + 1 > maxBookingsPerSlot) {
        slots.push({ ...base, available: false, reason: "pacing_bookings" });
        continue;
      }
      const coversInSlot = inSlot.reduce((n, b) => n + b.covers, 0);
      if (maxCoversPerSlot !== undefined && coversInSlot + covers > maxCoversPerSlot) {
        slots.push({ ...base, available: false, reason: "pacing_covers" });
        continue;
      }

      // The new booking also needs its own reset buffer before the next party sits down.
      const end = t + duration + service.bufferMinutes;
      const assignment = units.find((u) => unitIsFree(u, occupancy, t, end));
      slots.push(
        assignment
          ? { ...base, available: true, assignment }
          : { ...base, available: false, reason: "no_table" },
      );
    }
  }
  return slots;
}

/**
 * Pick tables for a specific requested time, or explain why not.
 * Use this at booking creation; the database exclusion constraint is the final guard.
 */
export function allocate(
  req: AvailabilityRequest & { serviceId: string; time: Minutes; ignoreBookingId?: string },
): Slot {
  const service = req.venue.services.find((s) => s.id === req.serviceId);
  if (!service) throw new Error(`Unknown service ${req.serviceId}`);
  if (!service.daysOfWeek.includes(req.dayOfWeek)) {
    throw new Error(`Service ${service.id} does not run on day ${req.dayOfWeek}`);
  }
  // Re-run availability with the booking being amended removed, then pick the matching slot.
  const bookings = req.ignoreBookingId
    ? req.bookings.filter((b) => b.id !== req.ignoreBookingId)
    : req.bookings;
  const slot = getAvailability({ ...req, bookings, venue: { ...req.venue, services: [service] } }).find(
    (s) => s.time === req.time,
  );
  if (!slot) throw new Error(`${req.time} is not a valid start time for service ${service.id}`);
  return slot;
}
