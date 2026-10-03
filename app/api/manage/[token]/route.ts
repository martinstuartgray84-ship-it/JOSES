import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/src/server/db";
import { cancelBookingByToken } from "@/src/server/manage";
import { trySendBookingEmail } from "@/src/server/notify";

// DELETE cancels the booking. The token itself is the credential.
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const cancelled = await cancelBookingByToken(db(), token);
  if (cancelled) await trySendBookingEmail(db(), cancelled, "cancellation");
  return cancelled
    ? NextResponse.json({ status: "cancelled" })
    : NextResponse.json({ error: "This booking can't be cancelled online. Please call us." }, { status: 409 });
}
