import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/src/server/db";
import { unsubscribe } from "@/src/server/marketing";

// RFC 8058 one-click unsubscribe (List-Unsubscribe-Post). Mail clients POST here.
export async function POST(_req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const r = await unsubscribe(db(), token);
  return r ? new NextResponse(null, { status: 200 }) : new NextResponse(null, { status: 404 });
}

// A browser following the header link gets the confirmation page.
export async function GET(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  return NextResponse.redirect(new URL(`/u/${token}`, req.url));
}
