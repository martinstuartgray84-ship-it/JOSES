import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/src/server/db";
import { BookingError, getSite } from "@/src/server/booking";
import { siteStationList } from "@/src/server/kitchen";
import { requireStaff } from "@/src/server/staff";
import "../kds.css";

export const metadata: Metadata = { title: "Screens", robots: { index: false } };
export const dynamic = "force-dynamic";

const KIND_TEXT = { kitchen: "Cooks food", bar: "Makes drinks (served when ready)", pass: "Checks plates and sends them out" };

export default async function StationsIndex({ params }: { params: Promise<{ site: string }> }) {
  const { site: slug } = await params;
  await requireStaff(`/kds/${slug}`);
  try {
    const site = await getSite(db(), slug);
    const stations = await siteStationList(db(), site);
    return (
      <main className="page" style={{ maxWidth: 720, margin: "0 auto", width: "100%" }}>
        <div className="page-head">
          <h1>Kitchen &amp; bar screens · {site.name}</h1>
        </div>
        <p className="muted" style={{ margin: 0 }}>
          Open one screen per station on its own tablet or monitor. Orders appear the moment the till sends them.
        </p>
        <div className="box" style={{ display: "grid", gap: 8 }}>
          {stations.map((s) => (
            <Link key={s.code} href={`/kds/${slug}/${s.code}`} className="station-link">
              <strong>{s.name}</strong>
              <span className="muted small">{KIND_TEXT[s.kind]}</span>
            </Link>
          ))}
          {stations.length === 0 && <p className="muted">No stations yet. Importing a menu creates them.</p>}
        </div>
      </main>
    );
  } catch (err) {
    if (err instanceof BookingError) notFound();
    throw err;
  }
}
