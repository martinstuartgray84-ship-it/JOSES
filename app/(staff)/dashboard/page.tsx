import type { Metadata } from "next";
import { db } from "@/src/server/db";
import { listSites } from "@/src/server/manage";
import { requireStaff } from "@/src/server/staff";
import {
  bookingStats,
  busyHeatmap,
  compsAndVoids,
  daily,
  guestStats,
  liveNow,
  menuEngineering,
  previousRange,
  slowDishes,
  speedByHour,
  stageTimes,
  staffPerformance,
  summary,
  type Range,
} from "@/src/server/analytics";
import DashboardView from "./DashboardView";
import "./dashboard.css";

export const metadata: Metadata = { title: "Dashboard", robots: { index: false } };
export const dynamic = "force-dynamic";

const PRESETS: Record<string, number> = { today: 1, "7d": 7, "28d": 28, "90d": 90 };

function todayIn(tz: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
}
const shift = (date: string, days: number) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const isDate = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; from?: string; to?: string; site?: string }>;
}) {
  await requireStaff("/dashboard");
  const sp = await searchParams;
  const sql = db();
  const sites = await listSites(sql, process.env.COMPANY_SLUG);
  const [company] = await sql`select c.id from companies c join venues v on v.company_id = c.id where v.slug = ${sites[0]?.slug ?? ""}`;
  if (!company || sites.length === 0) {
    return (
      <main className="page">
        <p className="muted">No sites yet.</p>
      </main>
    );
  }
  const tz = sites[0]!.timezone;
  const today = todayIn(tz);
  const preset = sp.range && sp.range in PRESETS ? sp.range : isDate(sp.from) && isDate(sp.to) ? "custom" : "28d";
  let from = shift(today, -(PRESETS[preset] ?? 28) + 1);
  let to = today;
  if (preset === "custom") {
    from = sp.from! <= sp.to! ? sp.from! : sp.to!;
    to = sp.from! <= sp.to! ? sp.to! : sp.from!;
  }
  const siteFilter = sites.find((s) => s.slug === sp.site);
  const siteIdRows = await sql`select id, slug from venues where company_id = ${company.id}`;
  const idOf = new Map(siteIdRows.map((r) => [r.slug as string, r.id as string]));
  const r: Range = { companyId: company.id, siteIds: siteFilter ? [idOf.get(siteFilter.slug)!] : [], from, to, timezone: tz };
  const prev = previousRange(r);

  const [cur, before, days, hours, stages, slow, menu, staff, bookings, guests, heat, reasons, live] = await Promise.all([
    summary(sql, r),
    summary(sql, prev),
    daily(sql, r),
    speedByHour(sql, r),
    stageTimes(sql, r),
    slowDishes(sql, r),
    menuEngineering(sql, r),
    staffPerformance(sql, r),
    bookingStats(sql, r),
    guestStats(sql, r),
    busyHeatmap(sql, r),
    compsAndVoids(sql, r),
    liveNow(sql, company.id, r.siteIds, tz),
  ]);

  return (
    <DashboardView
      filters={{ preset, from, to, site: siteFilter?.slug ?? "all" }}
      sites={sites.map((s) => ({ slug: s.slug, name: s.name, id: idOf.get(s.slug)! }))}
      data={JSON.parse(JSON.stringify({ cur, before, days, hours, stages, slow, menu, staff, bookings, guests, heat, reasons, live }))}
    />
  );
}
