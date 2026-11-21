import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { db } from "@/src/server/db";
import { dataStatus } from "@/src/server/growth";
import { isStaff } from "@/src/server/staff";
import { getSite } from "@/src/server/booking";
import GrowthNav from "../GrowthNav";
import "../../dashboard/dashboard.css";
import "../growth.css";

export const metadata: Metadata = { title: "Growth", robots: { index: false } };
export const dynamic = "force-dynamic";

const day = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

// Pages call growthSite() themselves: a layout isn't a security boundary.
export default async function GrowthLayout({ children, params }: { children: React.ReactNode; params: Promise<{ site: string }> }) {
  const { site: slug } = await params;
  const site = (await isStaff()) ? await getSite(db(), slug).catch(() => null) : null;
  if (!site) return <>{children}</>;
  const status = await dataStatus(db(), site.id);
  return (
    <main className="page dash growth">
      <div className="gtop">
        <strong>Growth</strong>
        <span className="muted">{site.name}</span>
        {status.checks === 0 ? (
          <Link className="chip warn" href={`/growth/${slug}/data`}>No data loaded</Link>
        ) : status.sample ? (
          <span className="chip info">Sample data: every figure is invented</span>
        ) : (
          <span className="chip good">Data to {day(status.lastDay!)}</span>
        )}
      </div>
      <Suspense>
        <GrowthNav slug={slug} />
      </Suspense>
      {children}
    </main>
  );
}
