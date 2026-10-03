import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { db } from "@/src/server/db";
import { BookingError, getSite } from "@/src/server/booking";
import { KitchenError, stationQueue } from "@/src/server/kitchen";
import { requireStaff } from "@/src/server/staff";
import StationScreen from "./StationScreen";
import "../../kds.css";

export const metadata: Metadata = { title: "Station", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function StationPage({ params }: { params: Promise<{ site: string; station: string }> }) {
  const { site: slug, station } = await params;
  await requireStaff(`/kds/${slug}/${station}`);
  try {
    const site = await getSite(db(), slug);
    const q = await stationQueue(db(), site, station);
    return <StationScreen siteSlug={slug} siteName={site.name} initial={JSON.parse(JSON.stringify(q))} />;
  } catch (err) {
    if (err instanceof BookingError || err instanceof KitchenError) notFound();
    throw err;
  }
}
