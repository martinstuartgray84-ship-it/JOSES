// The host's view of one site on one day: every table, every booking on it,
// and the totals a host glances at before service.

import type { Sql } from "postgres";
import { BookingError, getSite } from "./booking";

import { allowedTransitions, type DiaryStatus } from "../lib/diary-shared";

export type { DiaryStatus };

export interface DiaryTable {
  id: string;
  label: string;
  areaId: string;
  areaName: string;
  minCovers: number;
  maxCovers: number;
  bookableOnline: boolean;
  posX: number | null;
  posY: number | null;
  shape: "round" | "square" | "rect" | null;
}

export interface DiaryBooking {
  id: string;
  serviceId: string;
  /** Minutes from local midnight. */
  start: number;
  durationMinutes: number;
  bufferMinutes: number;
  covers: number;
  status: DiaryStatus;
  channel: string;
  tableIds: string[];
  guestName: string;
  guestPhone: string | null;
  guestTags: string[];
  /** Past visits across both sites, so hosts can spot regulars. */
  visits: number;
  noShows: number;
  specialRequests: string | null;
}

export interface DiaryService {
  id: string;
  name: string;
  firstSeating: number;
  lastSeating: number;
  /** Latest finish of any booking in this service, for sizing the timeline. */
  endsBy: number;
}

export interface DiaryBlock {
  tableId: string;
  start: number;
  end: number;
  reason: string | null;
}

export interface Diary {
  site: { slug: string; name: string; timezone: string };
  date: string;
  dayOfWeek: number;
  tables: DiaryTable[];
  services: DiaryService[];
  bookings: DiaryBooking[];
  blocks: DiaryBlock[];
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function loadDiary(sql: Sql, siteSlug: string, date: string): Promise<Diary> {
  if (!DATE_RE.test(date) || Number.isNaN(Date.parse(date))) {
    throw new BookingError("invalid_date", `Invalid date ${date}`);
  }
  const site = await getSite(sql, siteSlug);
  const tz = site.timezone;
  // Local minutes from this date's midnight for a timestamptz column.
  const mins = (col: string) =>
    sql.unsafe(`(extract(epoch from (${col} at time zone '${tz.replace(/'/g, "''")}') - '${date}'::date::timestamp) / 60)::int`);

  const [day] = await sql<{ dow: number }[]>`select extract(dow from ${date}::date)::int as dow`;

  const [tables, services, bookings, blocks] = await Promise.all([
    sql<DiaryTable[]>`
      select t.id, t.label, t.area_id as "areaId", a.name as "areaName", t.min_covers as "minCovers",
             t.max_covers as "maxCovers", t.bookable_online as "bookableOnline",
             t.pos_x as "posX", t.pos_y as "posY", t.shape
      from tables t join areas a on a.id = t.area_id
      where t.venue_id = ${site.id} and t.active
      order by a.sort_order, a.name, length(t.label), t.label`,
    sql<Omit<DiaryService, "endsBy">[]>`
      select s.id, s.name, s.first_seating as "firstSeating", s.last_seating as "lastSeating"
      from services s
      where s.venue_id = ${site.id} and s.active
        and ${day!.dow} = any(s.days_of_week)
        and (s.valid_from is null or s.valid_from <= ${date}::date)
        and (s.valid_to is null or s.valid_to >= ${date}::date)
        and not exists (select 1 from closures c where c.venue_id = s.venue_id and c.date = ${date}::date
                        and (c.service_id is null or c.service_id = s.id))
      order by s.first_seating`,
    sql<DiaryBooking[]>`
      select b.id, b.service_id as "serviceId", ${mins("b.starts_at")} as start,
             b.duration_minutes as "durationMinutes", b.buffer_minutes as "bufferMinutes",
             b.covers, b.status::text as status, b.channel::text as channel,
             coalesce(array_agg(bt.table_id) filter (where bt.table_id is not null), '{}') as "tableIds",
             coalesce(nullif(trim(concat_ws(' ', g.first_name, g.last_name)), ''), 'Walk-in') as "guestName",
             g.phone as "guestPhone", coalesce(g.tags, '{}') as "guestTags",
             coalesce(gs.visits, 0)::int as visits, coalesce(gs.no_shows, 0)::int as "noShows",
             b.special_requests as "specialRequests"
      from bookings b
      left join booking_tables bt on bt.booking_id = b.id
      left join guests g on g.id = b.guest_id
      left join guest_stats gs on gs.guest_id = b.guest_id
      where b.venue_id = ${site.id}
        and b.starts_at >= ${date}::date::timestamp at time zone ${tz}
        and b.starts_at < (${date}::date + 1)::timestamp at time zone ${tz}
      group by b.id, g.id, gs.visits, gs.no_shows
      order by b.starts_at, b.created_at`,
    sql<DiaryBlock[]>`
      select table_id as "tableId",
             greatest(${mins("lower(during)")}, 0) as start,
             least(${mins("upper(during)")}, 2880) as "end", reason
      from table_blocks
      where venue_id = ${site.id}
        and during && tstzrange(${date}::date::timestamp at time zone ${tz},
                                (${date}::date + 1)::timestamp at time zone ${tz})`,
  ]);

  return {
    site: { slug: site.slug, name: site.name, timezone: tz },
    date,
    dayOfWeek: day!.dow,
    tables,
    services: services.map((s) => ({
      ...s,
      endsBy: Math.max(
        s.lastSeating + 120,
        ...bookings.filter((b) => b.serviceId === s.id).map((b) => b.start + b.durationMinutes),
      ),
    })),
    bookings,
    blocks,
  };
}

export class StatusError extends Error {
  constructor(public code: "not_found" | "not_allowed" | "table_taken", message: string) {
    super(message);
  }
}

/**
 * Change a booking's status from the diary. Finishing a table early shortens the
 * booking so the table frees up on the timeline (and for online availability) now.
 * Reinstating a cancelled booking can fail if its table has since been rebooked.
 */
export async function setBookingStatus(
  sql: Sql,
  siteSlug: string,
  bookingId: string,
  to: DiaryStatus,
  now = new Date(),
): Promise<void> {
  const site = await getSite(sql, siteSlug);
  try {
    await sql.begin(async (tx) => {
      const [b] = await tx<{ status: DiaryStatus; startsAt: Date; durationMinutes: number }[]>`
        select status::text as status, starts_at as "startsAt", duration_minutes as "durationMinutes"
        from bookings where id = ${bookingId} and venue_id = ${site.id} for update`;
      if (!b) throw new StatusError("not_found", "Booking not found");
      if (!allowedTransitions(b.status).includes(to)) {
        throw new StatusError("not_allowed", `Can't change a ${b.status} booking to ${to}`);
      }
      let duration = b.durationMinutes;
      if (to === "completed") {
        const elapsed = Math.ceil((now.getTime() - b.startsAt.getTime()) / 60_000);
        if (elapsed > 0 && elapsed < duration) duration = elapsed;
      }
      await tx`update bookings set status = ${to}, duration_minutes = ${duration} where id = ${bookingId}`;
    });
  } catch (err) {
    if ((err as { code?: string }).code === "23P01") {
      throw new StatusError("table_taken", "That table has been rebooked since. Move the booking to another table first.");
    }
    throw err;
  }
}
