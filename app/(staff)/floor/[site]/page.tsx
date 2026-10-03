import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { db } from "@/src/server/db";
import { BookingError, getSite } from "@/src/server/booking";
import { liveFloor } from "@/src/server/floor";
import { requireStaff } from "@/src/server/staff";
import FloorCoach from "./FloorCoach";
import "../floor.css";

export const metadata: Metadata = { title: "Floor", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function FloorPage({ params }: { params: Promise<{ site: string }> }) {
  const { site: slug } = await params;
  await requireStaff(`/floor/${slug}`);
  try {
    const site = await getSite(db(), slug);
    const floor = await liveFloor(db(), site);
    return <FloorCoach site={{ slug, name: site.name }} floor={JSON.parse(JSON.stringify(floor))} now={new Date().toISOString()} />;
  } catch (err) {
    if (err instanceof BookingError) notFound();
    throw err;
  }
}
