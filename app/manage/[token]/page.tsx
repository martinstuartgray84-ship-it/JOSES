import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { db } from "@/src/server/db";
import { getBookingByToken } from "@/src/server/manage";
import CancelButton from "./CancelButton";

export const metadata: Metadata = { title: "Your booking", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function ManagePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const booking = await getBookingByToken(db(), token);
  if (!booking) notFound();

  const when = booking.startsAt.toLocaleString("en-GB", {
    timeZone: booking.timezone,
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
  const statusText: Record<string, string> = {
    pending: "Awaiting confirmation",
    confirmed: "Confirmed",
    seated: "Seated",
    completed: "Completed",
    cancelled: "Cancelled",
    no_show: "Missed",
  };

  return (
    <main className="wrap">
      <section className="card">
        <h2>{booking.firstName ? `Hi ${booking.firstName}` : "Your booking"}</h2>
        <dl className="details">
          <dt>Where</dt>
          <dd>{booking.siteName}</dd>
          <dt>When</dt>
          <dd>{when}</dd>
          <dt>Guests</dt>
          <dd>{booking.covers}</dd>
          {booking.specialRequests && (
            <>
              <dt>Notes</dt>
              <dd>{booking.specialRequests}</dd>
            </>
          )}
          <dt>Status</dt>
          <dd>{statusText[booking.status] ?? booking.status}</dd>
        </dl>
        {booking.cancellable && <CancelButton token={token} />}
        {booking.status !== "cancelled" && (
          <p className="hint">
            Need to change the time or party size? <a href={`/book?site=${booking.siteSlug}`}>Make a new booking</a>{" "}
            and cancel this one.
          </p>
        )}
      </section>
    </main>
  );
}
