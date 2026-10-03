import type { Metadata } from "next";
import { db } from "@/src/server/db";
import { emailConfigured } from "@/src/server/email";
import { staffCompany } from "@/src/server/guard";
import { listSites } from "@/src/server/manage";
import { AUTOMATION_DEFAULTS, listAutomations, listCampaigns } from "@/src/server/marketing";
import { requireStaff } from "@/src/server/staff";
import { PRESETS } from "@/src/marketing/segments";
import MarketingView from "./MarketingView";
import "../guests/guests.css";
import "./marketing.css";

export const metadata: Metadata = { title: "Marketing", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function MarketingPage({ searchParams }: { searchParams: Promise<{ seg?: string }> }) {
  await requireStaff("/marketing");
  const { seg } = await searchParams;
  const company = await staffCompany();
  const sql = db();
  const [campaigns, automations, sites, siteIds] = await Promise.all([
    listCampaigns(sql, company.id),
    listAutomations(sql, company.id),
    listSites(sql, process.env.COMPANY_SLUG),
    sql`select id, slug from venues where company_id = ${company.id}`,
  ]);
  const idOf = new Map(siteIds.map((r) => [r.slug as string, r.id as string]));
  return (
    <MarketingView
      companyName={company.name}
      emailReady={emailConfigured()}
      initialPreset={PRESETS.find((p) => p.key === seg)?.key ?? "lapsed"}
      sites={sites.map((s) => ({ id: idOf.get(s.slug)!, name: s.name }))}
      campaigns={JSON.parse(JSON.stringify(campaigns))}
      automations={JSON.parse(JSON.stringify(automations))}
      automationText={Object.fromEntries(Object.entries(AUTOMATION_DEFAULTS).map(([k, v]) => [k, { title: v.title, what: v.what }]))}
    />
  );
}
