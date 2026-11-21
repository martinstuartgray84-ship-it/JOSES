import { redirect } from "next/navigation";
import { db } from "@/src/server/db";
import { programmeSites } from "@/src/server/growth";
import { requireStaff } from "@/src/server/staff";

export const dynamic = "force-dynamic";

export default async function GrowthIndex() {
  await requireStaff("/growth");
  const sites = await programmeSites(db(), process.env.COMPANY_SLUG);
  if (!sites[0]) return <main className="page"><p className="muted">No sites yet.</p></main>;
  redirect(`/growth/${sites[0].slug}`);
}
