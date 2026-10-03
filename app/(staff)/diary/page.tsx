import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/src/server/db";
import { listSites } from "@/src/server/manage";
import { requireStaff } from "@/src/server/staff";

export const metadata: Metadata = { title: "Diary", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function DiaryIndex() {
  await requireStaff("/diary");
  const sites = await listSites(db(), process.env.COMPANY_SLUG);
  if (sites.length === 1) redirect(`/diary/${sites[0]!.slug}`);
  return (
    <main className="wrap">
      <section className="card">
        <h2>Which site?</h2>
        <div className="sites">
          {sites.map((s) => (
            <Link key={s.slug} href={`/diary/${s.slug}`} className="choice">
              {s.name}
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
