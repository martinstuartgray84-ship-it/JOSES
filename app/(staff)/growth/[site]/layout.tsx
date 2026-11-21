import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { Suspense } from "react";
import { db } from "@/src/server/db";
import { demoState, isDemo } from "@/src/server/demo";
import { dataStatus } from "@/src/server/growth";
import { exportWorkspace } from "@/src/server/workspace";
import { isStaff } from "@/src/server/staff";
import { getSite } from "@/src/server/booking";
import GrowthNav from "../GrowthNav";
import WorkspaceKeeper from "../../WorkspaceKeeper";
import "../../dashboard/dashboard.css";
import "../growth.css";

export const metadata: Metadata = { title: "Growth programme", robots: { index: false } };
export const dynamic = "force-dynamic";

const day = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

// Pages call growthSite() themselves: a layout isn't a security boundary.
export default async function GrowthLayout({ children, params }: { children: React.ReactNode; params: Promise<{ site: string }> }) {
  const { site: slug } = await params;
  const site = (await isStaff()) ? await getSite(db(), slug).catch(() => null) : null;
  if (!site) return <>{children}</>;
  const status = await dataStatus(db(), site.id);
  // Demo mode: hand the browser the current copy of the programme whenever it does not already hold it.
  let keeper: React.ReactNode = null;
  if (isDemo()) {
    const state = await demoState(db());
    const held = (await cookies()).get("ws")?.value;
    const data = held === `${state.bootId}:${state.rev}` ? null : JSON.stringify(await exportWorkspace(db(), site.companyId));
    keeper = <WorkspaceKeeper bootId={state.bootId} rev={state.rev} data={data} />;
  }
  return (
    <main className="page dash growth">
      {keeper}
      <div className="gtop">
        <strong>{site.name}</strong>
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
