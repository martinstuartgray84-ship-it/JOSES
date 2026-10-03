import type { NextRequest } from "next/server";
import { db } from "@/src/server/db";
import { recordOpen } from "@/src/server/marketing";

// 1×1 transparent GIF. Opens are a rough signal (images may be blocked or
// pre-fetched), which is why campaign results lead with return visits.
const PIXEL = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

export async function GET(_req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  try {
    await recordOpen(db(), token);
  } catch {
    // Never fail an image request.
  }
  return new Response(PIXEL, { headers: { "Content-Type": "image/gif", "Cache-Control": "no-store, max-age=0" } });
}
