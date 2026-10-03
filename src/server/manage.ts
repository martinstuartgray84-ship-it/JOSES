// Guest-facing lookups: the site list for the widget, and the self-serve
// view/cancel page reached through a booking's private manage link.

import type { Sql } from "postgres";

export interface PublicSite {
  slug: string;
  name: string;
  timezone: string;
  bookingWindowDays: number;
}

export async function listSites(sql: Sql, companySlug?: string): Promise<PublicSite[]> {
  return sql<PublicSite[]>`
    select v.slug, v.name, v.timezone, v.booking_window_days as "bookingWindowDays"
    from venues v join companies c on c.id = v.company_id
    where ${companySlug ?? null}::text is null or c.slug = ${companySlug ?? null}
    order by v.name`;
}

export interface ManagedBooking {
  siteName: string;
  siteSlug: string;
  timezone: string;
  startsAt: Date;
  covers: number;
  status: string;
  firstName: string;
  specialRequests: string | null;
  /** Whether the guest can still cancel online. */
  cancellable: boolean;
}

/** Tokens are 48 hex chars; reject anything else before touching the database. */
const TOKEN_RE = /^[0-9a-f]{48}$/;

export async function getBookingByToken(sql: Sql, token: string, now = new Date()): Promise<ManagedBooking | null> {
  if (!TOKEN_RE.test(token)) return null;
  const [row] = await sql<ManagedBooking[]>`
    select v.name as "siteName", v.slug as "siteSlug", v.timezone, b.starts_at as "startsAt",
           b.covers, b.status::text as status, coalesce(g.first_name, '') as "firstName",
           b.special_requests as "specialRequests",
           (b.status in ('pending', 'confirmed') and b.starts_at > ${now}) as cancellable
    from bookings b
    join venues v on v.id = b.venue_id
    left join guests g on g.id = b.guest_id
    where b.manage_token = ${token}`;
  return row ?? null;
}

/** Returns false if the token is unknown or the booking can no longer be cancelled. */
export async function cancelBookingByToken(sql: Sql, token: string, now = new Date()): Promise<boolean> {
  if (!TOKEN_RE.test(token)) return false;
  const rows = await sql`
    update bookings set status = 'cancelled'
    where manage_token = ${token} and status in ('pending', 'confirmed') and starts_at > ${now}
    returning id`;
  return rows.length === 1;
}
