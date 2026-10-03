import { NextResponse, type NextRequest } from "next/server";
import { availabilityQuery, firstIssue, type AvailabilityResponse } from "@/src/lib/api";
import { db } from "@/src/server/db";
import { BookingError, loadSiteDay } from "@/src/server/booking";
import { getAvailability } from "@/src/availability";

export async function GET(req: NextRequest) {
  const parsed = availabilityQuery.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
  }
  const { site, date, covers } = parsed.data;
  try {
    const day = await loadSiteDay(db(), site, date, { channel: "online" });
    const names = new Map(day.request.venue.services.map((s) => [s.id, s.name]));
    const body: AvailabilityResponse = {
      site: { slug: day.site.slug, name: day.site.name },
      date,
      // Only bookable times, and never which table: that's decided at booking time.
      slots: getAvailability({ ...day.request, covers })
        .filter((s) => s.available)
        .map((s) => ({ serviceId: s.serviceId, serviceName: names.get(s.serviceId) ?? "", time: s.time })),
    };
    return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof BookingError) {
      const status = err.code === "unknown_site" ? 404 : 400;
      return NextResponse.json({ error: err.message, code: err.code }, { status });
    }
    throw err;
  }
}
