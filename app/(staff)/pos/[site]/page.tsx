import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { db } from "@/src/server/db";
import { BookingError, getSite } from "@/src/server/booking";
import { listStaff, siteFloor } from "@/src/server/orders";
import { liveFloor } from "@/src/server/floor";
import { requireStaff, tillUserId } from "@/src/server/staff";
import PinPad from "./PinPad";
import PosFloor from "./PosFloor";
import "../pos.css";

export const metadata: Metadata = { title: "Till", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function PosPage({ params }: { params: Promise<{ site: string }> }) {
  const { site: slug } = await params;
  await requireStaff(`/pos/${slug}`);
  let site;
  try {
    site = await getSite(db(), slug);
  } catch (err) {
    if (err instanceof BookingError) notFound();
    throw err;
  }
  const staff = await listStaff(db(), site.companyId);
  const userId = await tillUserId();
  const user = staff.find((s) => s.id === userId);
  if (!user) return <PinPad siteSlug={slug} staff={staff} />;

  const [floor, coach] = await Promise.all([siteFloor(db(), site), liveFloor(db(), site)]);
  const tips = Object.fromEntries(
    coach.tables.filter((t) => t.result.nudges[0]).map((t) => [t.orderId, { title: t.result.nudges[0]!.title, priority: t.result.nudges[0]!.priority }]),
  );
  return <PosFloor site={{ slug, name: site.name }} user={user} floor={floor} tips={tips} />;
}
