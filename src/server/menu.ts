// Menu: company-wide items with per-site overrides (hide, price, 86, stock).

import type { Sql, TransactionSql } from "postgres";
import { guessCategoryDefaults, type ImportedItem } from "../menu/import";
import { getSite, type Site } from "./booking";

type Db = Sql | TransactionSql;

export interface MenuOption {
  id: string;
  name: string;
  priceDelta: number;
}

export interface MenuModifierGroup {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  options: MenuOption[];
}

export interface MenuItem {
  id: string;
  categoryId: string;
  name: string;
  description: string | null;
  /** Base company price. */
  basePrice: number;
  /** Price at this site (override or base). */
  price: number;
  cost: number | null;
  vatRate: number;
  course: number;
  station: string;
  prepMinutes: number;
  allergens: string[];
  dietary: string[];
  sortOrder: number;
  active: boolean;
  /** Site-level state (absent when no site was asked for). */
  hidden: boolean;
  eightySixed: boolean;
  stockRemaining: number | null;
  /** Can be ordered right now at this site. */
  available: boolean;
  modifierGroups: MenuModifierGroup[];
}

export interface MenuCategory {
  id: string;
  name: string;
  defaultCourse: number;
  defaultStation: string;
  sortOrder: number;
  active: boolean;
  items: MenuItem[];
}

export interface Station {
  id: string;
  code: string;
  name: string;
  kind: "kitchen" | "bar" | "pass";
}

export async function siteStations(sql: Db, venueId: string): Promise<Station[]> {
  return sql<Station[]>`
    select id, code, name, kind::text as kind from stations where venue_id = ${venueId} order by sort_order, name`;
}

/**
 * The menu as seen from one site. Items hidden at the site are still returned
 * (flagged) so the editor can show them; the POS filters on `available`.
 */
export async function loadMenu(sql: Db, site: Site, opts: { includeInactive?: boolean } = {}): Promise<MenuCategory[]> {
  const includeInactive = opts.includeInactive ?? false;
  const [categories, items, groups, options, links] = await Promise.all([
    sql`select id, name, default_course, default_station, sort_order, active
        from menu_categories where company_id = ${site.companyId} and (active or ${includeInactive})
        order by sort_order, name`,
    sql`select i.*, s.hidden, s.price_override, s.eighty_sixed_at, s.stock_remaining
        from menu_items i
        left join menu_item_sites s on s.menu_item_id = i.id and s.venue_id = ${site.id}
        where i.company_id = ${site.companyId} and (i.active or ${includeInactive})
        order by i.sort_order, i.name`,
    sql`select id, name, min_select, max_select from modifier_groups where company_id = ${site.companyId}`,
    sql`select o.id, o.group_id, o.name, o.price_delta from modifier_options o
        join modifier_groups g on g.id = o.group_id
        where g.company_id = ${site.companyId} order by o.sort_order, o.name`,
    sql`select l.menu_item_id, l.group_id from menu_item_modifier_groups l
        join menu_items i on i.id = l.menu_item_id
        where i.company_id = ${site.companyId} order by l.sort_order`,
  ]);

  const groupById = new Map<string, MenuModifierGroup>(
    groups.map((g) => [g.id, { id: g.id, name: g.name, minSelect: g.min_select, maxSelect: g.max_select, options: [] }]),
  );
  for (const o of options) groupById.get(o.group_id)?.options.push({ id: o.id, name: o.name, priceDelta: o.price_delta });
  const groupsForItem = new Map<string, MenuModifierGroup[]>();
  for (const l of links) {
    const g = groupById.get(l.group_id);
    if (g) groupsForItem.set(l.menu_item_id, [...(groupsForItem.get(l.menu_item_id) ?? []), g]);
  }

  return categories.map((c) => ({
    id: c.id,
    name: c.name,
    defaultCourse: c.default_course,
    defaultStation: c.default_station,
    sortOrder: c.sort_order,
    active: c.active,
    items: items
      .filter((i) => i.category_id === c.id)
      .map((i): MenuItem => {
        const hidden = i.hidden ?? false;
        const eightySixed = !!i.eighty_sixed_at;
        const stockRemaining: number | null = i.stock_remaining ?? null;
        return {
          id: i.id,
          categoryId: i.category_id,
          name: i.name,
          description: i.description,
          basePrice: i.price,
          price: i.price_override ?? i.price,
          cost: i.cost,
          vatRate: Number(i.vat_rate),
          course: i.course ?? c.default_course,
          station: i.station ?? c.default_station,
          prepMinutes: i.prep_minutes,
          allergens: i.allergens,
          dietary: i.dietary,
          sortOrder: i.sort_order,
          active: i.active,
          hidden,
          eightySixed,
          stockRemaining,
          available: i.active && c.active && !hidden && !eightySixed && stockRemaining !== 0,
          modifierGroups: groupsForItem.get(i.id) ?? [],
        };
      }),
  }));
}

export async function loadSiteMenu(sql: Db, siteSlug: string, opts: { includeInactive?: boolean } = {}) {
  const site = await getSite(sql, siteSlug);
  return { site, menu: await loadMenu(sql, site, opts) };
}

async function siteOverride(sql: Db, itemId: string, venueId: string, set: Record<string, unknown>) {
  const [own] = await sql`
    select 1 from menu_items i join venues v on v.company_id = i.company_id
    where i.id = ${itemId} and v.id = ${venueId}`;
  if (!own) throw new Error("That item isn't on this site's menu");
  await sql`
    insert into menu_item_sites ${sql({ menu_item_id: itemId, venue_id: venueId, ...set })}
    on conflict (menu_item_id, venue_id) do update set ${sql(set)}`;
}

/** Sold out (or back on) at one site. Clearing the 86 also clears a zero stock count. */
export async function setEightySixed(sql: Db, itemId: string, venueId: string, out: boolean) {
  if (out) await siteOverride(sql, itemId, venueId, { eighty_sixed_at: new Date() });
  else {
    await siteOverride(sql, itemId, venueId, { eighty_sixed_at: null });
    await sql`update menu_item_sites set stock_remaining = null
              where menu_item_id = ${itemId} and venue_id = ${venueId} and stock_remaining = 0`;
  }
}

export async function setStock(sql: Db, itemId: string, venueId: string, stock: number | null) {
  if (stock !== null && (!Number.isInteger(stock) || stock < 0)) throw new Error("Stock must be a whole number");
  await siteOverride(sql, itemId, venueId, { stock_remaining: stock });
}

export async function setSitePrice(sql: Db, itemId: string, venueId: string, price: number | null) {
  if (price !== null && (!Number.isInteger(price) || price < 0)) throw new Error("Price must be whole pence");
  await siteOverride(sql, itemId, venueId, { price_override: price });
}

export async function setHidden(sql: Db, itemId: string, venueId: string, hidden: boolean) {
  await siteOverride(sql, itemId, venueId, { hidden });
}

export interface ItemInput {
  categoryId: string;
  name: string;
  description?: string | null;
  price: number;
  cost?: number | null;
  vatRate?: number;
  course?: number | null;
  station?: string | null;
  prepMinutes?: number;
  allergens?: string[];
  dietary?: string[];
  active?: boolean;
}

export async function saveItem(sql: Sql, companyId: string, input: ItemInput & { id?: string }): Promise<string> {
  const row = {
    category_id: input.categoryId,
    name: input.name.trim(),
    description: input.description?.trim() || null,
    price: input.price,
    cost: input.cost ?? null,
    vat_rate: input.vatRate ?? 20,
    course: input.course ?? null,
    station: input.station || null,
    prep_minutes: input.prepMinutes ?? 10,
    allergens: input.allergens ?? [],
    dietary: input.dietary ?? [],
    active: input.active ?? true,
  };
  const [cat] = await sql`select 1 from menu_categories where id = ${input.categoryId} and company_id = ${companyId}`;
  if (!cat) throw new Error("Unknown category");
  if (input.id) {
    const [r] = await sql`update menu_items set ${sql(row)} where id = ${input.id} and company_id = ${companyId} returning id`;
    if (!r) throw new Error("Unknown item");
    return r.id;
  }
  const [r] = await sql`insert into menu_items ${sql({ ...row, company_id: companyId })} returning id`;
  return r!.id;
}

export interface ApplyImportResult {
  categoriesCreated: number;
  itemsCreated: number;
  itemsUpdated: number;
  modifierGroups: number;
}

/**
 * Apply parsed import rows in one transaction. Items match on category + name
 * (case-insensitive): existing ones are updated, new ones created. Modifier
 * groups are company-wide and match on name; their options are replaced.
 */
export async function applyImport(sql: Sql, companyId: string, items: ImportedItem[]): Promise<ApplyImportResult> {
  return sql.begin(async (tx) => {
    const result: ApplyImportResult = { categoriesCreated: 0, itemsCreated: 0, itemsUpdated: 0, modifierGroups: 0 };
    const catIds = new Map<string, string>();
    const existingCats = await tx`select id, name from menu_categories where company_id = ${companyId}`;
    for (const c of existingCats) catIds.set(c.name.toLowerCase(), c.id);
    let catOrder = existingCats.length;

    const groupIds = new Map<string, string>();
    for (const g of await tx`select id, name from modifier_groups where company_id = ${companyId}`) {
      groupIds.set(g.name.toLowerCase(), g.id);
    }
    const touchedGroups = new Set<string>();

    for (const [order, it] of items.entries()) {
      let catId = catIds.get(it.category.toLowerCase());
      if (!catId) {
        const d = guessCategoryDefaults(it.category);
        const [c] = await tx`
          insert into menu_categories (company_id, name, default_course, default_station, sort_order)
          values (${companyId}, ${it.category}, ${d.course}, ${d.station}, ${catOrder++}) returning id`;
        catId = c!.id as string;
        catIds.set(it.category.toLowerCase(), catId);
        result.categoriesCreated++;
      }
      const fields = {
        description: it.description,
        price: it.price,
        cost: it.cost,
        vat_rate: it.vatRate ?? 20,
        course: it.course,
        station: it.station,
        prep_minutes: it.prepMinutes ?? 10,
        allergens: it.allergens,
        dietary: it.dietary,
        sort_order: order,
        active: true,
      };
      const [existing] = await tx`
        select id from menu_items where company_id = ${companyId} and category_id = ${catId} and lower(name) = lower(${it.name})`;
      let itemId: string;
      if (existing) {
        await tx`update menu_items set ${tx(fields)} where id = ${existing.id}`;
        itemId = existing.id;
        result.itemsUpdated++;
      } else {
        const [r] = await tx`insert into menu_items ${tx({ ...fields, company_id: companyId, category_id: catId, name: it.name })} returning id`;
        itemId = r!.id;
        result.itemsCreated++;
      }

      await tx`delete from menu_item_modifier_groups where menu_item_id = ${itemId}`;
      for (const [gi, g] of it.modifiers.entries()) {
        const key = g.name.toLowerCase();
        let groupId = groupIds.get(key);
        if (!groupId) {
          const [r] = await tx`
            insert into modifier_groups (company_id, name, min_select, max_select)
            values (${companyId}, ${g.name}, ${g.minSelect}, ${g.maxSelect}) returning id`;
          groupId = r!.id as string;
          groupIds.set(key, groupId);
        }
        if (!touchedGroups.has(groupId)) {
          // First time this import mentions the group: its definition wins.
          await tx`update modifier_groups set min_select = ${g.minSelect}, max_select = ${g.maxSelect} where id = ${groupId}`;
          await tx`delete from modifier_options where group_id = ${groupId}`;
          for (const [oi, o] of g.options.entries()) {
            await tx`insert into modifier_options (group_id, name, price_delta, sort_order)
                     values (${groupId}, ${o.name}, ${o.priceDelta}, ${oi})`;
          }
          touchedGroups.add(groupId);
          result.modifierGroups++;
        }
        await tx`insert into menu_item_modifier_groups (menu_item_id, group_id, sort_order) values (${itemId}, ${groupId}, ${gi})`;
      }
    }
    // Make sure every station the menu routes to exists at every site.
    const codes = [...new Set(items.map((i) => i.station).filter((c): c is string => !!c))];
    for (const code of codes) {
      const kind = /bar|drink|cocktail|wine/.test(code) ? "bar" : code === "pass" ? "pass" : "kitchen";
      const name = code.replace(/[-_]/g, " ").replace(/^./, (c) => c.toUpperCase());
      await tx`
        insert into stations (venue_id, code, name, kind)
        select v.id, ${code}, ${name}, ${kind}::station_kind from venues v where v.company_id = ${companyId}
        on conflict (venue_id, code) do nothing`;
    }
    return result;
  });
}

/** Decrement limited stock when items are sent; 86 automatically at zero. */
export async function consumeStock(sql: Db, venueId: string, counts: Map<string, number>) {
  for (const [itemId, qty] of counts) {
    await sql`
      update menu_item_sites
         set stock_remaining = greatest(stock_remaining - ${qty}, 0),
             eighty_sixed_at = case when stock_remaining - ${qty} <= 0 then coalesce(eighty_sixed_at, now()) else eighty_sixed_at end
       where menu_item_id = ${itemId} and venue_id = ${venueId} and stock_remaining is not null`;
  }
}
