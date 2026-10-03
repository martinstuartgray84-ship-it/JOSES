import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/src/server/db";
import { cancelBookingByToken } from "@/src/server/manage";

// DELETE cancels the booking. The token itself is the credential.
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const ok = await cancelBookingByToken(db(), token);
  return ok
    ? NextResponse.json({ status: "cancelled" })
    : NextResponse.json({ error: "This booking can't be cancelled online. Please call us." }, { status: 409 });
}
