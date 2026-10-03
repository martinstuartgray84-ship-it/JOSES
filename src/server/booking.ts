// Server-side booking service: loads one site's day from Postgres, runs the
// availability engine, and writes bookings. Runs with a privileged connection
// (Supabase service role / direct DATABASE_URL), never from the browser.

import type { Sql, TransactionSql } from "postgres";
import { allocate, getAvailability } from "../availability";
import type {
  AvailabilityRequest,
  ExistingBooking,
  Minutes,
  Slot,
  TableBlock,
  VenueConfig,
} from "../availability";

type Db = Sql | TransactionSql;

export type Channel = "online" | "phone" | "walk_in" | "staff";

export interface Site {
  id: string;
  companyId: string;
  name: string;
  slug: string;
  timezone: string;
  minNoticeMinutes: number;
  bookingWindowDays: number;
}

export interface SiteDay {
  site: Site;
  date: string;
  request: Omit<AvailabilityRequest, "covers">;
}

export class BookingError extends Error {
  constructor(
    public code: "unknown_site" | "invalid_date" | "unavailable" | "conflict",
    message: string,
    public slot?: Slot,
  ) {
    super(message);
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Bookings that started up to this long before local midnight can still hold tables. */
const LOOKBACK_HOURS = 12;

/** Stand-in for an open-ended table block, in minutes. */
const UNBOUNDED = 100_000;

export async function getSite(sql: Db, slug: string): Promise<Site> {
  const [row] = await sql<Site[]>`
    select id, company_id as "companyId", name, slug, timezone,
           min_notice_minutes as "minNoticeMinutes", booking_window_days as "bookingWindowDays"
    from venues where slug = ${slug}`;
  if (!row) throw new BookingError("unknown_site", `No site called ${slug}`);
  return row;
}

/**
 * Everything the engine needs for one site on one local date. Times become minutes
 * from local midnight in the site's timezone, so DST is handled by Postgres.
 */
export async function loadSiteDay(
  sql: Db,
  slug: string,
  date: string,
  opts: { channel?: Channel; now?: Date } = {},
): Promise<SiteDay> {
  if (!DATE_RE.test(date) || Number.isNaN(Date.parse(date))) {
    throw new BookingError("invalid_date", `Invalid date ${date}`);
  }
  const site = await getSite(sql, slug);
  const channel = opts.channel ?? "online";
  const now = opts.now ?? new Date();

  const [day] = await sql<{ dow: number; nowMinutes: number; daysAhead: number }[]>`
    select extract(dow from ${date}::date)::int as dow,
           (extract(epoch from (${now}::timestamptz at time zone ${site.timezone})
                 - ${date}::date::timestamp) / 60)::int as "nowMinutes",
           (${date}::date - (${now}::timestamptz at time zone ${site.timezone})::date) as "daysAhead"`;
  if (!day) throw new Error("date query returned nothing");

  const [tables, combinations, services, turnTimes, bookings, blocks] = await Promise.all([
    sql`select id, area_id, min_covers, max_covers, bookable_online
        from tables where venue_id = ${site.id} and active`,
    sql`select c.id, c.min_covers, c.max_covers, c.bookable_online,
               array_agg(m.table_id order by m.table_id) as table_ids
        from table_combinations c join table_combination_members m on m.combination_id = c.id
        where c.venue_id = ${site.id}
        group by c.id`,
    sql`select s.* from services s
        where s.venue_id = ${site.id} and s.active
          and (s.valid_from is null or s.valid_from <= ${date}::date)
          and (s.valid_to is null or s.valid_to >= ${date}::date)
          and not exists (
            select 1 from closures c
            where c.venue_id = s.venue_id and c.date = ${date}::date
              and (c.service_id is null or c.service_id = s.id))`,
    sql`select t.service_id, t.max_covers, t.minutes
        from service_turn_times t join services s on s.id = t.service_id
        where s.venue_id = ${site.id}`,
    sql`select b.id, b.service_id, b.covers, b.status, b.duration_minutes,
               (extract(epoch from (b.starts_at at time zone ${site.timezone}) - ${date}::date::timestamp) / 60)::int as start,
               coalesce(array_agg(bt.table_id) filter (where bt.table_id is not null), '{}') as table_ids
        from bookings b left join booking_tables bt on bt.booking_id = b.id
        where b.venue_id = ${site.id}
          and b.starts_at >= (${date}::date::timestamp - make_interval(hours => ${LOOKBACK_HOURS})) at time zone ${site.timezone}
          and b.starts_at < (${date}::date + 2)::timestamp at time zone ${site.timezone}
        group by b.id`,
    sql`select table_id,
               coalesce((extract(epoch from (lower(during) at time zone ${site.timezone}) - ${date}::date::timestamp) / 60)::int,
                        ${-UNBOUNDED}) as start,
               coalesce((extract(epoch from (upper(during) at time zone ${site.timezone}) - ${date}::date::timestamp) / 60)::int,
                        ${UNBOUNDED}) as "end"
        from table_blocks
        where venue_id = ${site.id}
          and during && tstzrange(
            (${date}::date::timestamp - make_interval(hours => ${LOOKBACK_HOURS})) at time zone ${site.timezone},
            (${date}::date + 2)::timestamp at time zone ${site.timezone})`,
  ]);

  const venue: VenueConfig = {
    tables: tables.map((t) => ({
      id: t.id,
      areaId: t.area_id,
      minCovers: t.min_covers,
      maxCovers: t.max_covers,
      bookableOnline: t.bookable_online,
    })),
    combinations: combinations.map((c) => ({
      id: c.id,
      tableIds: c.table_ids,
      minCovers: c.min_covers,
      maxCovers: c.max_covers,
      bookableOnline: c.bookable_online,
    })),
    services: services
      .map((s) => ({
        id: s.id,
        name: s.name,
        daysOfWeek: s.days_of_week,
        firstSeating: s.first_seating,
        lastSeating: s.last_seating,
        slotIntervalMinutes: s.slot_interval_minutes,
        bufferMinutes: s.buffer_minutes,
        minCovers: s.min_covers,
        maxCovers: s.max_covers,
        areaIds: s.area_ids ?? undefined,
        pacing: {
          maxCoversPerSlot: s.max_covers_per_slot ?? undefined,
          maxBookingsPerSlot: s.max_bookings_per_slot ?? undefined,
        },
        turnTimes: turnTimes
          .filter((t) => t.service_id === s.id)
          .map((t) => ({ maxCovers: t.max_covers, minutes: t.minutes })),
      }))
      // A service with no turn times can't be booked; skip rather than crash the whole day.
      .filter((s) => s.turnTimes.length > 0),
  };

  const existing: ExistingBooking[] = bookings.map((b) => ({
    id: b.id,
    serviceId: b.service_id,
    start: b.start,
    durationMinutes: b.duration_minutes,
    covers: b.covers,
    tableIds: b.table_ids,
    status: b.status,
  }));
  const tableBlocks: TableBlock[] = blocks.map((b) => ({ tableId: b.table_id, start: b.start, end: b.end }));

  // Online guests get minimum notice and the booking window; staff can book anything.
  let notBefore: Minutes | undefined;
  if (channel === "online") {
    if (day.daysAhead > site.bookingWindowDays) venue.services = [];
    notBefore = day.nowMinutes + site.minNoticeMinutes;
  }

  return {
    site,
    date,
    request: {
      venue,
      dayOfWeek: day.dow,
      bookings: existing,
      blocks: tableBlocks,
      channel: channel === "online" ? "online" : "staff",
      notBefore,
    },
  };
}

export async function siteAvailability(
  sql: Db,
  slug: string,
  date: string,
  covers: number,
  opts: { channel?: Channel; now?: Date } = {},
): Promise<{ site: Site; date: string; slots: Slot[] }> {
  const day = await loadSiteDay(sql, slug, date, opts);
  return { site: day.site, date, slots: getAvailability({ ...day.request, covers }) };
}

export interface GuestDetails {
  firstName: string;
  lastName?: string;
  email?: string;
  phone?: string;
  marketingOptIn?: boolean;
}

export interface CreateBookingInput {
  siteSlug: string;
  date: string;
  /** Minutes from local midnight, on the service's slot grid. */
  time: Minutes;
  serviceId: string;
  covers: number;
  guest: GuestDetails;
  channel?: Channel;
  specialRequests?: string;
  now?: Date;
}

export interface CreatedBooking {
  id: string;
  manageToken: string;
  guestId: string;
  startsAt: Date;
  tableIds: string[];
}

/**
 * Find or create the guest in the company-wide list. Matches on email first,
 * then phone, so a regular at one site is recognised at the other.
 */
export async function upsertGuest(sql: Db, companyId: string, g: GuestDetails): Promise<string> {
  const email = g.email?.trim().toLowerCase() || null;
  const phone = g.phone?.replace(/[^\d+]/g, "") || null;
  if (email) {
    const [row] = await sql<{ id: string }[]>`
      insert into guests (company_id, first_name, last_name, email, phone, marketing_opt_in)
      values (${companyId}, ${g.firstName}, ${g.lastName ?? null}, ${email}, ${phone}, ${g.marketingOptIn ?? false})
      on conflict (company_id, lower(email)) where email is not null
      do update set phone = coalesce(excluded.phone, guests.phone),
                    last_name = coalesce(excluded.last_name, guests.last_name),
                    marketing_opt_in = guests.marketing_opt_in or excluded.marketing_opt_in
      returning id`;
    return row!.id;
  }
  if (phone) {
    const [found] = await sql<{ id: string }[]>`
      select id from guests where company_id = ${companyId} and phone = ${phone}
      order by created_at limit 1`;
    if (found) return found.id;
  }
  const [row] = await sql<{ id: string }[]>`
    insert into guests (company_id, first_name, last_name, phone, marketing_opt_in)
    values (${companyId}, ${g.firstName}, ${g.lastName ?? null}, ${phone}, ${g.marketingOptIn ?? false})
    returning id`;
  return row!.id;
}

const MAX_ATTEMPTS = 3;

/**
 * Book a table. Bookings for the same site and date are serialised with an advisory
 * lock so pacing limits hold under concurrent requests. The exclusion constraint
 * still backs this up against writes that skip the lock (e.g. staff moving a
 * booking in the diary); if it fires we retry with fresh data.
 */
export async function createBooking(sql: Sql, input: CreateBookingInput): Promise<CreatedBooking> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await sql.begin(async (tx) => {
        await tx`select pg_advisory_xact_lock(hashtextextended(${`booking:${input.siteSlug}:${input.date}`}, 0))`;
        const day = await loadSiteDay(tx, input.siteSlug, input.date, { channel: input.channel, now: input.now });
        const service = day.request.venue.services.find((s) => s.id === input.serviceId);
        if (!service) throw new BookingError("unavailable", "That service isn't available on this date");

        const slot = allocate({ ...day.request, covers: input.covers, serviceId: service.id, time: input.time });
        if (!slot.available || !slot.assignment) {
          throw new BookingError("unavailable", `No availability: ${slot.reason}`, slot);
        }

        const guestId = await upsertGuest(tx, day.site.companyId, input.guest);
        const [booking] = await tx<{ id: string; manage_token: string; starts_at: Date }[]>`
          insert into bookings (venue_id, service_id, guest_id, covers, starts_at, duration_minutes,
                                buffer_minutes, status, channel, special_requests)
          values (${day.site.id}, ${service.id}, ${guestId}, ${input.covers},
                  (${input.date}::date + make_interval(mins => ${input.time})) at time zone ${day.site.timezone},
                  ${slot.durationMinutes}, ${service.bufferMinutes}, 'confirmed',
                  ${input.channel ?? "online"}, ${input.specialRequests ?? null})
          returning id, manage_token, starts_at`;
        await tx`
          insert into booking_tables ${tx(slot.assignment.tableIds.map((table_id) => ({ booking_id: booking!.id, table_id })))}`;

        return {
          id: booking!.id,
          manageToken: booking!.manage_token,
          guestId,
          startsAt: booking!.starts_at,
          tableIds: slot.assignment.tableIds,
        };
      });
    } catch (err) {
      const raced = (err as { code?: string }).code === "23P01";
      if (raced && attempt < MAX_ATTEMPTS) continue;
      if (raced) throw new BookingError("conflict", "That time was just taken, please pick another");
      throw err;
    }
  }
}
