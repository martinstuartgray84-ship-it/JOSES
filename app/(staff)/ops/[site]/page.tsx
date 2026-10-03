import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { db } from "@/src/server/db";
import { BookingError, getSite, isRealDate, localParts } from "@/src/server/booking";
import { forecastDay, liveOps } from "@/src/server/ops";
import { requireStaff } from "@/src/server/staff";
import OpsView from "./OpsView";
import "../../dashboard/dashboard.css";
import "../ops.css";

export const metadata: Metadata = { title: "Operations", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function OpsPage({ params, searchParams }: { params: Promise<{ site: string }>; searchParams: Promise<{ date?: string }> }) {
  const { site: slug } = await params;
  const { date: asked } = await searchParams;
  await requireStaff(`/ops/${slug}`);
  try {
    const sql = db();
    const site = await getSite(sql, slug);
    const now = new Date();
    const today = localParts(now, site.timezone).date;
    const date = asked && isRealDate(asked) ? asked : today;
    const todayPlan = await forecastDay(sql, site, today, now);
    const [live, plan] = await Promise.all([liveOps(sql, site, now, undefined, todayPlan), date === today ? todayPlan : forecastDay(sql, site, date, now)]);
    return <OpsView site={{ slug, name: site.name }} today={today} live={JSON.parse(JSON.stringify(live))} plan={plan} nowHour={Math.floor(localParts(now, site.timezone).minutes / 60)} />;
  } catch (err) {
    if (err instanceof BookingError) notFound();
    throw err;
  }
}
