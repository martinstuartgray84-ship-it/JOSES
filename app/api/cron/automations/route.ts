import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/src/server/db";
import { runAutomations } from "@/src/server/marketing";

// Call hourly from a scheduler (Vercel Cron, Supabase pg_cron + pg_net, or any
// cron) with "Authorization: Bearer $CRON_SECRET". Safe to call more often:
// each automation messages a guest at most once per occasion.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  const ok = !!secret && given.length === secret.length && timingSafeEqual(Buffer.from(given), Buffer.from(secret));
  if (!ok) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  const companies = await db()`select id, slug from companies`;
  const results: Record<string, unknown> = {};
  for (const c of companies) results[c.slug] = await runAutomations(db(), c.id);
  return NextResponse.json({ ranAt: new Date().toISOString(), results });
}
