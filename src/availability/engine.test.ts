import { describe, expect, it } from "vitest";
import { allocate, candidateUnits, getAvailability, turnTimeFor } from "./engine";
import type { ExistingBooking, Service, VenueConfig } from "./types";

const hm = (h: number, m = 0) => h * 60 + m;

const dinner: Service = {
  id: "dinner",
  name: "Dinner",
  daysOfWeek: [2, 3, 4, 5, 6],
  firstSeating: hm(17),
  lastSeating: hm(21),
  slotIntervalMinutes: 15,
  turnTimes: [
    { maxCovers: 2, minutes: 90 },
    { maxCovers: 4, minutes: 120 },
    { maxCovers: 8, minutes: 150 },
  ],
  bufferMinutes: 15,
  minCovers: 1,
  maxCovers: 8,
};

const venue: VenueConfig = {
  tables: [
    { id: "T1", areaId: "main", minCovers: 1, maxCovers: 2, bookableOnline: true },
    { id: "T2", areaId: "main", minCovers: 1, maxCovers: 2, bookableOnline: true },
    { id: "T3", areaId: "main", minCovers: 2, maxCovers: 4, bookableOnline: true },
    { id: "T4", areaId: "main", minCovers: 2, maxCovers: 4, bookableOnline: true },
    { id: "T5", areaId: "terrace", minCovers: 2, maxCovers: 4, bookableOnline: false },
  ],
  combinations: [
    { id: "T1+T2", tableIds: ["T1", "T2"], minCovers: 3, maxCovers: 4, bookableOnline: true },
    { id: "T3+T4", tableIds: ["T3", "T4"], minCovers: 5, maxCovers: 8, bookableOnline: true },
  ],
  services: [dinner],
};

const booking = (over: Partial<ExistingBooking> & Pick<ExistingBooking, "start" | "tableIds">): ExistingBooking => ({
  id: `b-${over.start}-${over.tableIds.join("")}`,
  serviceId: "dinner",
  durationMinutes: 120,
  covers: 4,
  status: "confirmed",
  ...over,
});

const slotAt = (slots: ReturnType<typeof getAvailability>, time: number) => {
  const s = slots.find((x) => x.time === time);
  if (!s) throw new Error(`no slot at ${time}`);
  return s;
};

describe("turnTimeFor", () => {
  it("picks the smallest band that fits", () => {
    expect(turnTimeFor(dinner, 1)).toBe(90);
    expect(turnTimeFor(dinner, 2)).toBe(90);
    expect(turnTimeFor(dinner, 3)).toBe(120);
    expect(turnTimeFor(dinner, 8)).toBe(150);
  });

  it("falls back to the largest band for oversize parties", () => {
    expect(turnTimeFor(dinner, 12)).toBe(150);
  });
});

describe("candidateUnits", () => {
  it("orders by best fit, single tables before combinations", () => {
    const units = candidateUnits(venue, 3, { channel: "online" });
    expect(units.map((u) => u.unitId)).toEqual(["T3", "T4", "T1+T2"]);
  });

  it("respects table minimums so a couple doesn't take a four-top first", () => {
    const units = candidateUnits(venue, 2, { channel: "online" });
    expect(units.map((u) => u.unitId)).toEqual(["T1", "T2", "T3", "T4"]);
  });

  it("hides staff-only tables from online but not staff", () => {
    expect(candidateUnits(venue, 4, { channel: "online" }).some((u) => u.unitId === "T5")).toBe(false);
    expect(candidateUnits(venue, 4, { channel: "staff" }).some((u) => u.unitId === "T5")).toBe(true);
  });

  it("restricts to service areas", () => {
    const units = candidateUnits(venue, 4, { channel: "staff", areaIds: ["terrace"] });
    expect(units.map((u) => u.unitId)).toEqual(["T5"]);
  });
});

describe("getAvailability", () => {
  it("returns every slot in the service on an open day", () => {
    const slots = getAvailability({ venue, dayOfWeek: 5, covers: 2, bookings: [] });
    expect(slots).toHaveLength(17); // 17:00 to 21:00 every 15 minutes
    expect(slots.every((s) => s.available)).toBe(true);
    expect(slotAt(slots, hm(17)).assignment?.unitId).toBe("T1");
  });

  it("returns nothing on a closed day", () => {
    expect(getAvailability({ venue, dayOfWeek: 1, covers: 2, bookings: [] })).toEqual([]);
  });

  it("rejects party sizes outside the service range", () => {
    const slots = getAvailability({ venue, dayOfWeek: 5, covers: 9, bookings: [] });
    expect(slots.every((s) => s.reason === "party_size_out_of_range")).toBe(true);
  });

  it("uses a combination when the large tables are taken", () => {
    const bookings = [booking({ start: hm(19), tableIds: ["T3"] }), booking({ start: hm(19), tableIds: ["T4"] })];
    const slot = slotAt(getAvailability({ venue, dayOfWeek: 5, covers: 4, bookings }), hm(19));
    expect(slot.assignment?.unitId).toBe("T1+T2");
  });

  it("never offers a combination when one of its tables is in use", () => {
    const bookings = [
      booking({ start: hm(19), tableIds: ["T3"] }),
      booking({ start: hm(19), tableIds: ["T4"] }),
      booking({ start: hm(19), tableIds: ["T1"], covers: 2, durationMinutes: 90 }),
    ];
    const slot = slotAt(getAvailability({ venue, dayOfWeek: 5, covers: 4, bookings }), hm(19));
    expect(slot).toMatchObject({ available: false, reason: "no_table" });
  });

  it("blocks the reset buffer after an existing booking", () => {
    // T3 and T4 busy 17:00-19:00, plus 15 min reset, so free from 19:15.
    const bookings = [
      booking({ start: hm(17), tableIds: ["T3"] }),
      booking({ start: hm(17), tableIds: ["T4"] }),
      booking({ start: hm(17), tableIds: ["T1", "T2"] }),
    ];
    const slots = getAvailability({ venue, dayOfWeek: 5, covers: 4, bookings });
    expect(slotAt(slots, hm(19)).available).toBe(false);
    expect(slotAt(slots, hm(19, 15)).available).toBe(true);
  });

  it("blocks a slot whose booking would run into a later one", () => {
    // A party of 2 at 18:00 needs T1 until 19:30 + 15 buffer = 19:45.
    const bookings = [
      booking({ start: hm(19, 45), tableIds: ["T1"], covers: 2 }),
      booking({ start: hm(19, 30), tableIds: ["T2"], covers: 2 }),
      booking({ start: hm(19, 30), tableIds: ["T3"] }),
      booking({ start: hm(19, 30), tableIds: ["T4"] }),
    ];
    const slots = getAvailability({ venue, dayOfWeek: 5, covers: 2, bookings });
    expect(slotAt(slots, hm(18)).assignment?.unitId).toBe("T1");
    expect(slotAt(slots, hm(18, 15)).available).toBe(false);
  });

  it("ignores cancelled, completed and no-show bookings for table occupancy", () => {
    const bookings = (["cancelled", "completed", "no_show"] as const).map((status, i) =>
      booking({ id: `x${i}`, start: hm(19), tableIds: ["T1"], covers: 2, status }),
    );
    const slot = slotAt(getAvailability({ venue, dayOfWeek: 5, covers: 2, bookings }), hm(19));
    expect(slot.assignment?.unitId).toBe("T1");
  });

  it("applies table blocks", () => {
    const blocks = [{ tableId: "T1", start: hm(17), end: hm(23) }];
    const slot = slotAt(getAvailability({ venue, dayOfWeek: 5, covers: 2, bookings: [], blocks }), hm(19));
    expect(slot.assignment?.unitId).toBe("T2");
  });

  it("enforces covers pacing per slot", () => {
    const paced: VenueConfig = { ...venue, services: [{ ...dinner, pacing: { maxCoversPerSlot: 6 } }] };
    const bookings = [booking({ start: hm(19, 5), tableIds: ["T3"], covers: 4 })];
    const slots = getAvailability({ venue: paced, dayOfWeek: 5, covers: 3, bookings });
    expect(slotAt(slots, hm(19))).toMatchObject({ available: false, reason: "pacing_covers" });
    expect(slotAt(slots, hm(19, 15)).available).toBe(true);
    // A couple still fits the 19:00 pacing budget.
    const couple = getAvailability({ venue: paced, dayOfWeek: 5, covers: 2, bookings });
    expect(slotAt(couple, hm(19)).available).toBe(true);
  });

  it("counts no-shows towards pacing but not cancellations", () => {
    const paced: VenueConfig = { ...venue, services: [{ ...dinner, pacing: { maxBookingsPerSlot: 1 } }] };
    const cancelled = [booking({ start: hm(19), tableIds: ["T3"], status: "cancelled" })];
    expect(slotAt(getAvailability({ venue: paced, dayOfWeek: 5, covers: 2, bookings: cancelled }), hm(19)).available).toBe(true);
    const noShow = [booking({ start: hm(19), tableIds: ["T3"], status: "no_show" })];
    expect(slotAt(getAvailability({ venue: paced, dayOfWeek: 5, covers: 2, bookings: noShow }), hm(19)).reason).toBe(
      "pacing_bookings",
    );
  });

  it("marks slots before the notice cutoff as too soon", () => {
    const slots = getAvailability({ venue, dayOfWeek: 5, covers: 2, bookings: [], notBefore: hm(18) });
    expect(slotAt(slots, hm(17, 45)).reason).toBe("too_soon");
    expect(slotAt(slots, hm(18)).available).toBe(true);
  });

  it("lets staff seat at tables online guests can't book", () => {
    const bookings = ["T1", "T2", "T3", "T4"].map((t) => booking({ start: hm(19), tableIds: [t] }));
    const online = slotAt(getAvailability({ venue, dayOfWeek: 5, covers: 4, bookings }), hm(19));
    const staff = slotAt(getAvailability({ venue, dayOfWeek: 5, covers: 4, bookings, channel: "staff" }), hm(19));
    expect(online.available).toBe(false);
    expect(staff.assignment?.unitId).toBe("T5");
  });

  it("supports services that run past midnight", () => {
    const late: Service = { ...dinner, id: "late", firstSeating: hm(23), lastSeating: hm(24, 30) };
    const slots = getAvailability({ venue: { ...venue, services: [late] }, dayOfWeek: 5, covers: 2, bookings: [] });
    expect(slots.map((s) => s.time)).toEqual([hm(23), hm(23, 15), hm(23, 30), hm(23, 45), hm(24), hm(24, 15), hm(24, 30)]);
  });

  it("never double-books: greedily filling every offered slot leaves no table overlaps", () => {
    const bookings: ExistingBooking[] = [];
    for (const covers of [2, 4, 2, 6, 3, 2, 4, 1, 8, 2, 4, 2, 3, 2, 5]) {
      const slot = getAvailability({ venue, dayOfWeek: 5, covers, bookings }).find((s) => s.available);
      if (!slot?.assignment) continue;
      bookings.push(
        booking({
          id: `g${bookings.length}`,
          start: slot.time,
          durationMinutes: slot.durationMinutes,
          covers,
          tableIds: slot.assignment.tableIds,
        }),
      );
    }
    expect(bookings.length).toBeGreaterThan(5);
    for (const a of bookings) {
      for (const b of bookings) {
        if (a === b || !a.tableIds.some((t) => b.tableIds.includes(t))) continue;
        const aEnd = a.start + a.durationMinutes + dinner.bufferMinutes;
        const bEnd = b.start + b.durationMinutes + dinner.bufferMinutes;
        expect(a.start < bEnd && b.start < aEnd, `${a.id} overlaps ${b.id}`).toBe(false);
      }
    }
  });
});

describe("allocate", () => {
  it("returns the assignment for a specific time", () => {
    const slot = allocate({ venue, dayOfWeek: 5, covers: 4, bookings: [], serviceId: "dinner", time: hm(19) });
    expect(slot.assignment?.unitId).toBe("T3");
  });

  it("ignores the booking being amended so it can keep or move its own table", () => {
    const own = booking({ id: "mine", start: hm(19), tableIds: ["T1"], covers: 2, durationMinutes: 90 });
    const others = ["T2", "T3", "T4"].map((t) => booking({ start: hm(19), tableIds: [t] }));
    const bookings = [own, ...others];
    expect(allocate({ venue, dayOfWeek: 5, covers: 2, bookings, serviceId: "dinner", time: hm(19, 15) }).available).toBe(false);
    const moved = allocate({
      venue,
      dayOfWeek: 5,
      covers: 2,
      bookings,
      serviceId: "dinner",
      time: hm(19, 15),
      ignoreBookingId: "mine",
    });
    expect(moved.assignment?.unitId).toBe("T1");
  });

  it("rejects times that aren't on the slot grid", () => {
    expect(() => allocate({ venue, dayOfWeek: 5, covers: 2, bookings: [], serviceId: "dinner", time: hm(19, 7) })).toThrow();
  });

  it("rejects services that don't run that day", () => {
    expect(() => allocate({ venue, dayOfWeek: 1, covers: 2, bookings: [], serviceId: "dinner", time: hm(19) })).toThrow();
  });
});
