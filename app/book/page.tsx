import type { Metadata } from "next";
import { db } from "@/src/server/db";
import { listSites } from "@/src/server/manage";
import BookingWidget from "./BookingWidget";

export const metadata: Metadata = { title: "Book a table" };
export const dynamic = "force-dynamic";

// /book shows a site picker; /book?site=<slug> skips it (use that in each site's website embed).
export default async function BookPage({ searchParams }: { searchParams: Promise<{ site?: string }> }) {
  const { site } = await searchParams;
  const sites = await listSites(db(), process.env.COMPANY_SLUG);
  const fixedSite = site && sites.some((s) => s.slug === site) ? site : undefined;
  return (
    <main className="wrap">
      <BookingWidget sites={sites} fixedSite={fixedSite} />
    </main>
  );
}
