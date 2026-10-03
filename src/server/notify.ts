// Booking emails: confirmation, reminder the day before, cancellation.
// These are service messages (no marketing consent needed) and are recorded in
// booking_messages, so each kind goes to a booking at most once.

import type { Sql } from "postgres";
import { renderTransactional } from "../marketing/template";
import { appUrl, deliver } from "./email";

export type BookingMessageKind = "confirmation" | "reminder" | "cancellation";

/** Reminders go to bookings starting between these many hours from now. */
const REMINDER_FROM_H = 20;
const REMINDER_TO_H = 28;

interface BookingForEmail {
  id: string;
  email: string | null;
  firstName: string;
  covers: number;
  startsAt: Date;
  status: string;
  timezone: string;
  site: string;
  company: string;
  manageToken: string;
  specialRequests: string | null;
}

async function loadBooking(sql: Sql, bookingId: string): Promise<BookingForEmail | null> {
  const [b] = await sql`
    select b.id, g.email, coalesce(g.first_name, '') as first_name, b.covers, b.starts_at, b.status::text as status,
           v.timezone, v.name as site, c.name as company, b.manage_token, b.special_requests
    from bookings b join venues v on v.id = b.venue_id join companies c on c.id = v.company_id
    left join guests g on g.id = b.guest_id
    where b.id = ${bookingId}`;
  if (!b) return null;
  return {
    id: b.id,
    email: b.email,
    firstName: b.first_name,
    covers: b.covers,
    startsAt: b.starts_at,
    status: b.status,
    timezone: b.timezone,
    site: b.site,
    company: b.company,
    manageToken: b.manage_token,
    specialRequests: b.special_requests,
  };
}

export function bookingEmail(kind: BookingMessageKind, b: BookingForEmail) {
  const when = b.startsAt.toLocaleString("en-GB", {
    timeZone: b.timezone,
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
  const shortDay = b.startsAt.toLocaleDateString("en-GB", { timeZone: b.timezone, weekday: "long", day: "numeric", month: "short" });
  const name = b.firstName || "there";
  const details: [string, string][] = [
    ["Where", b.site],
    ["When", when],
    ["Guests", String(b.covers)],
  ];
  if (b.specialRequests && kind !== "cancellation") details.push(["Your note", b.specialRequests]);
  const manage = { label: "View or cancel your booking", url: `${appUrl()}/manage/${b.manageToken}` };
  const footer = `${b.site} · ${b.company}. You're getting this because you booked a table.`;
  if (kind === "confirmation") {
    return renderTransactional({
      subject: `Booking confirmed: ${b.site}, ${shortDay}`,
      heading: `You're booked, ${name}`,
      lines: ["We're looking forward to seeing you. If your plans change, you can cancel from the link below."],
      details,
      button: manage,
      footer,
    });
  }
  if (kind === "reminder") {
    return renderTransactional({
      subject: `See you tomorrow at ${b.site}`,
      heading: `See you soon, ${name}`,
      lines: ["Just a reminder of your table. If you can't make it, please let us know so someone else can have it."],
      details,
      button: manage,
      footer,
    });
  }
  return renderTransactional({
    subject: `Booking cancelled: ${b.site}, ${shortDay}`,
    heading: "Your booking is cancelled",
    lines: [`Sorry we won't see you this time, ${name}. We hope to see you another day.`],
    details,
    button: { label: "Book another time", url: `${appUrl()}/book` },
    footer,
  });
}

/**
 * Send one kind of booking email, once. Returns what happened; never throws on
 * delivery problems (a booking must not fail because email did).
 */
export async function sendBookingEmail(sql: Sql, bookingId: string, kind: BookingMessageKind): Promise<"sent" | "logged" | "failed" | "skipped"> {
  const b = await loadBooking(sql, bookingId);
  if (!b || !b.email) return "skipped";
  if (kind !== "cancellation" && b.status === "cancelled") return "skipped";
  // Claim the send; a previous failure can be claimed again (retried).
  const claimed = await sql`
    insert into booking_messages (booking_id, kind, email) values (${b.id}, ${kind}, ${b.email})
    on conflict (booking_id, kind) do update set status = 'queued', error = null, email = excluded.email
      where booking_messages.status = 'failed'
    returning booking_id`;
  if (!claimed.length) return "skipped";
  const [res] = await deliver([{ to: b.email, ...bookingEmail(kind, b) }]);
  await sql`update booking_messages set status = ${res!.status}, provider_id = ${res!.providerId ?? null},
            error = ${res!.error ?? null}, sent_at = ${res!.status === "failed" ? null : new Date()}
            where booking_id = ${b.id} and kind = ${kind}`;
  return res!.status;
}

/** Fire-and-forget wrapper for request handlers. */
export async function trySendBookingEmail(sql: Sql, bookingId: string, kind: BookingMessageKind) {
  try {
    return await sendBookingEmail(sql, bookingId, kind);
  } catch (err) {
    console.error(`booking ${kind} email failed`, err);
    return "failed" as const;
  }
}

/** Day-before reminders. Safe to run repeatedly. */
export async function sendDueReminders(sql: Sql, now = new Date()) {
  const due = await sql`
    select b.id from bookings b join guests g on g.id = b.guest_id
    where b.status in ('pending', 'confirmed') and g.email is not null
      and b.starts_at between ${new Date(now.getTime() + REMINDER_FROM_H * 3_600_000)} and ${new Date(now.getTime() + REMINDER_TO_H * 3_600_000)}
      -- Booked less than a day ahead: the confirmation was the reminder.
      and b.created_at < b.starts_at - interval '24 hours'
      and not exists (select 1 from booking_messages m where m.booking_id = b.id and m.kind = 'reminder')`;
  const counts = { sent: 0, logged: 0, failed: 0, skipped: 0 };
  for (const r of due) counts[await trySendBookingEmail(sql, r.id, "reminder")]++;
  // Retry recent failures (e.g. a provider outage) while they're still useful.
  const failed = await sql`
    select m.booking_id, m.kind::text as kind from booking_messages m join bookings b on b.id = m.booking_id
    where m.status = 'failed' and m.created_at > ${new Date(now.getTime() - 2 * 86_400_000)}
      and (m.kind = 'cancellation' or b.starts_at > ${now})`;
  let retriedOk = 0;
  for (const f of failed) if ((await trySendBookingEmail(sql, f.booking_id, f.kind as BookingMessageKind)) !== "failed") retriedOk++;
  return { due: due.length, ...counts, retriedOk };
}
