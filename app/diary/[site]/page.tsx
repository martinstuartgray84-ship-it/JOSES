import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { db } from "@/src/server/db";
import { BookingError } from "@/src/server/booking";
import { loadDiary } from "@/src/server/diary";
import { listSites } from "@/src/server/manage";
import { requireStaff } from "@/src/server/staff";
import DiaryView from "./DiaryView";
import "../diary.css";

export const metadata: Metadata = { title: "Diary", robots: { index: false } };
export const dynamic = "force-dynamic";

const todayIn = (tz: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());

/** Minutes since local midnight right now in the site's timezone. */
function nowMinutesIn(tz: string) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date());
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return get("hour") * 60 + get("minute");
}

export default async function SiteDiary({
  params,
  searchParams,
}: {
  params: Promise<{ site: string }>;
  searchParams: Promise<{ date?: string }>;
}) {
  const { site } = await params;
  const { date: dateParam } = await searchParams;
  await requireStaff(`/diary/${site}`);

  const sites = await listSites(db(), process.env.COMPANY_SLUG);
  const current = sites.find((s) => s.slug === site);
  if (!current) notFound();

  const today = todayIn(current.timezone);
  const date = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : today;
  try {
    const diary = await loadDiary(db(), site, date);
    return (
      <DiaryView
        diary={diary}
        sites={sites.map((s) => ({ slug: s.slug, name: s.name }))}
        today={today}
        nowMinutes={date === today ? nowMinutesIn(current.timezone) : null}
      />
    );
  } catch (err) {
    if (err instanceof BookingError) notFound();
    throw err;
  }
}
