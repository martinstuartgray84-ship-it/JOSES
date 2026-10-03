import { NextResponse, type NextRequest } from "next/server";
import { BookingError, getSite } from "@/src/server/booking";
import { db } from "@/src/server/db";
import { KitchenError, stationQueue } from "@/src/server/kitchen";
import { isStaff } from "@/src/server/staff";

// Polled every few seconds by station screens.
export async function GET(_req: NextRequest, ctx: { params: Promise<{ site: string; station: string }> }) {
  if (!(await isStaff())) return NextResponse.json({ error: "Sign in" }, { status: 401 });
  const { site: slug, station } = await ctx.params;
  try {
    const site = await getSite(db(), slug);
    const q = await stationQueue(db(), site, station);
    return NextResponse.json({ ...q, serverTime: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof BookingError || err instanceof KitchenError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    throw err;
  }
}
