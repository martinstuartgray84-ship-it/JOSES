// What every Growth page needs: the signed-in check, the site, its settings,
// the model and the selected period.

import { notFound } from "next/navigation";
import { db } from "@/src/server/db";
import { getSite, type Site } from "@/src/server/booking";
import { staffCompany } from "@/src/server/guard";
import { dataStatus, getSettings, loadModel, type GrowthSettings } from "@/src/server/growth";
import { requireStaff, tillUserId } from "@/src/server/staff";
import { period, type Model, type Period } from "@/src/growth/engine";

export type SP = Promise<Record<string, string | string[] | undefined>>;
export const one = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

export async function growthSite(slug: string, page = ""): Promise<Site> {
  await requireStaff(`/growth/${slug}${page}`);
  const company = await staffCompany();
  const site = await getSite(db(), slug).catch(() => null);
  if (!site || site.companyId !== company.id) notFound();
  return site;
}

export interface Ctx {
  site: Site;
  settings: GrowthSettings;
  model: Model | null;
  /** Weeks in the selected period; 0 means everything loaded. */
  weeks: number;
  period: Period | null;
  sample: boolean;
}

export async function growthCtx(slug: string, sp: SP, page = ""): Promise<Ctx> {
  const site = await growthSite(slug, page);
  const sql = db();
  const [settings, model, status, params] = await Promise.all([getSettings(sql, site.id), loadModel(sql, site.id), dataStatus(sql, site.id), sp]);
  const w = one(params.w);
  const weeks = w === "4" ? 4 : w === "0" ? 0 : 12;
  return { site, settings, model, weeks, period: model ? period(model, weeks) : null, sample: status.sample };
}

/**
 * Whether this device may see figures for individual servers. The staff app
 * has one shared sign-in, so the person is identified by their till PIN:
 * unless the venue opens server figures to everyone, a manager must be signed
 * in on the till.
 */
export async function canSeeServers(settings: GrowthSettings, companyId: string): Promise<boolean> {
  if (settings.serverFiguresMinRole === "host") return true;
  const staffId = await tillUserId();
  if (!staffId) return false;
  const [s] = await db()`select 1 from staff_members where id = ${staffId} and company_id = ${companyId} and active and role = 'manager'`;
  return !!s;
}

/** Keep the period when moving between views. */
export const withPeriod = (href: string, weeks: number, extra: Record<string, string> = {}): string => {
  const q = new URLSearchParams(extra);
  if (weeks !== 12) q.set("w", String(weeks));
  const s = q.toString();
  return s ? `${href}?${s}` : href;
};
