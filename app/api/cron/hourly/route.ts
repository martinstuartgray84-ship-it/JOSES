import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/src/server/db";
import { retryRecipients, runAutomations } from "@/src/server/marketing";
import { runScorecards } from "@/src/server/growth-programme";
import { sendDueReminders } from "@/src/server/notify";

// Call hourly from a scheduler (Vercel Cron, Supabase pg_cron + pg_net, or any
// cron) with "Authorization: Bearer $CRON_SECRET". Sends day-before booking
// reminders, runs marketing automations, and from Monday 07:00 at each site
// builds and emails last week's Growth scorecard. Safe to call more often: every
// message is recorded and never repeated.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  const ok = !!secret && given.length === secret.length && timingSafeEqual(Buffer.from(given), Buffer.from(secret));
  if (!ok) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  const reminders = await sendDueReminders(db());
  const companies = await db()`select id, slug from companies`;
  const automations: Record<string, unknown> = {};
  for (const c of companies) {
    automations[c.slug] = { ...(await runAutomations(db(), c.id)), retries: await retryRecipients(db(), c.id) };
  }
  const scorecards = await runScorecards(db()).catch((e) => ({ error: String(e) }));
  return NextResponse.json({ ranAt: new Date().toISOString(), reminders, automations, scorecards });
}
