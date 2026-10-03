import { NextResponse, type NextRequest } from "next/server";
import { createBookingBody, firstIssue, type BookingCreatedResponse } from "@/src/lib/api";
import { db } from "@/src/server/db";
import { BookingError, createBooking } from "@/src/server/booking";

const STATUS: Record<BookingError["code"], number> = {
  unknown_site: 404,
  invalid_date: 400,
  unavailable: 409,
  conflict: 409,
};

export async function POST(req: NextRequest) {
  const parsed = createBookingBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
  }
  const b = parsed.data;
  try {
    const booking = await createBooking(db(), {
      siteSlug: b.site,
      date: b.date,
      serviceId: b.serviceId,
      time: b.time,
      covers: b.covers,
      guest: b.guest,
      specialRequests: b.specialRequests,
      channel: "online",
    });
    const body: BookingCreatedResponse = { manageToken: booking.manageToken, startsAt: booking.startsAt.toISOString() };
    return NextResponse.json(body, { status: 201 });
  } catch (err) {
    if (err instanceof BookingError) {
      const message =
        err.code === "unavailable" ? "Sorry, that time has just gone. Please pick another." : err.message;
      return NextResponse.json({ error: message, code: err.code }, { status: STATUS[err.code] });
    }
    throw err;
  }
}
