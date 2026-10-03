"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { parseMenuImport } from "@/src/menu/import";
import { db } from "@/src/server/db";
import { act, staffSite } from "@/src/server/guard";
import { applyImport, saveItem, setEightySixed, setHidden, setSitePrice, setStock } from "@/src/server/menu";

const refresh = (site: string) => revalidatePath(`/menu/${site}`);

export async function importMenuAction(siteSlug: string, text: string) {
  return act(async () => {
    const site = await staffSite(siteSlug);
    // Re-parse on the server: never trust the browser's preview.
    const parsed = parseMenuImport(text);
    if (parsed.items.length === 0) throw new Error(parsed.problems[0]?.message ?? "Nothing to import");
    const result = await applyImport(db(), site.companyId, parsed.items);
    refresh(siteSlug);
    return { ...result, skipped: parsed.problems.length };
  });
}

export async function set86Action(siteSlug: string, itemId: string, out: boolean) {
  return act(async () => {
    const site = await staffSite(siteSlug);
    await setEightySixed(db(), itemId, site.id, out);
    refresh(siteSlug);
  });
}

export async function setStockAction(siteSlug: string, itemId: string, stock: number | null) {
  return act(async () => {
    const site = await staffSite(siteSlug);
    await setStock(db(), itemId, site.id, stock);
    if (stock !== null && stock > 0) await setEightySixed(db(), itemId, site.id, false);
    refresh(siteSlug);
  });
}

const itemSchema = z.object({
  id: z.uuid().optional(),
  categoryId: z.uuid(),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).nullable(),
  price: z.number().int().min(0).max(1_000_000),
  cost: z.number().int().min(0).max(1_000_000).nullable(),
  vatRate: z.number().min(0).max(100),
  course: z.number().int().min(0).max(9).nullable(),
  station: z.string().regex(/^[a-z][a-z0-9_-]*$/).nullable(),
  prepMinutes: z.number().int().min(0).max(240),
  allergens: z.array(z.string()),
  dietary: z.array(z.string().max(30)).max(10),
  active: z.boolean(),
  sitePrice: z.number().int().min(0).max(1_000_000).nullable(),
  siteHidden: z.boolean(),
});

export async function saveItemAction(siteSlug: string, input: z.infer<typeof itemSchema>) {
  return act(async () => {
    const site = await staffSite(siteSlug);
    const parsed = itemSchema.safeParse(input);
    if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Check the form");
    const { sitePrice, siteHidden, ...item } = parsed.data;
    const id = await saveItem(db(), site.companyId, item);
    await setSitePrice(db(), id, site.id, sitePrice);
    await setHidden(db(), id, site.id, siteHidden);
    refresh(siteSlug);
    return id;
  });
}

export async function addCategoryAction(siteSlug: string, name: string, course: number, station: string) {
  return act(async () => {
    const site = await staffSite(siteSlug);
    const clean = name.trim();
    if (!clean) throw new Error("Give the category a name");
    if (!/^[a-z][a-z0-9_-]*$/.test(station)) throw new Error("Pick a station");
    await db()`
      insert into menu_categories (company_id, name, default_course, default_station, sort_order)
      values (${site.companyId}, ${clean}, ${course}, ${station},
              (select coalesce(max(sort_order), 0) + 1 from menu_categories where company_id = ${site.companyId}))
      on conflict (company_id, name) do nothing`;
    refresh(siteSlug);
  });
}
