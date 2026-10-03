import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { db } from "@/src/server/db";
import { BookingError } from "@/src/server/booking";
import { loadSiteMenu, siteStations } from "@/src/server/menu";
import { requireStaff } from "@/src/server/staff";
import MenuEditor from "./MenuEditor";
import "../menu.css";

export const metadata: Metadata = { title: "Menu", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function MenuPage({ params }: { params: Promise<{ site: string }> }) {
  const { site: slug } = await params;
  await requireStaff(`/menu/${slug}`);
  try {
    const { site, menu } = await loadSiteMenu(db(), slug, { includeInactive: true });
    const stations = await siteStations(db(), site.id);
    return <MenuEditor site={{ slug: site.slug, name: site.name }} menu={menu} stations={stations} />;
  } catch (err) {
    if (err instanceof BookingError) notFound();
    throw err;
  }
}
