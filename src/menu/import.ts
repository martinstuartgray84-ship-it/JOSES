// Menu import from a spreadsheet (CSV or tab-separated, as pasted from Excel or
// Google Sheets). Pure: parses and validates, the server applies it.
//
// Columns (header row required, case and order don't matter, only category, name
// and price are required):
//   category, name, price, description, course, station, prep, allergens,
//   dietary, cost, vat, modifiers
//
// modifiers: "Temperature*: Rare | Medium | Well; Extras (max 3): Bacon +1.50 | Cheese +1"
//   "*" = required (pick one); "(max N)" = up to N; otherwise optional single choice.

export const UK_ALLERGENS = [
  "celery", "gluten", "crustaceans", "eggs", "fish", "lupin", "milk",
  "molluscs", "mustard", "nuts", "peanuts", "sesame", "soya", "sulphites",
] as const;
export type Allergen = (typeof UK_ALLERGENS)[number];

const ALLERGEN_ALIASES: Record<string, Allergen> = {
  wheat: "gluten", barley: "gluten", rye: "gluten", oats: "gluten", cereals: "gluten",
  egg: "eggs", dairy: "milk", lactose: "milk", cream: "milk", butter: "milk", cheese: "milk",
  "tree nuts": "nuts", treenuts: "nuts", nut: "nuts", almonds: "nuts", walnuts: "nuts", hazelnuts: "nuts",
  peanut: "peanuts", groundnuts: "peanuts",
  soy: "soya", soybean: "soya", soybeans: "soya",
  sulphur: "sulphites", "sulphur dioxide": "sulphites", sulfites: "sulphites", so2: "sulphites",
  shellfish: "crustaceans", prawns: "crustaceans", crab: "crustaceans", lobster: "crustaceans",
  mussels: "molluscs", oysters: "molluscs", squid: "molluscs", clams: "molluscs",
  lupine: "lupin", sesame_seeds: "sesame", "sesame seeds": "sesame",
};

const COURSE_WORDS: Record<string, number> = {
  drink: 0, drinks: 0, bar: 0, beverage: 0, beverages: 0,
  snack: 1, snacks: 1, starter: 1, starters: 1, appetiser: 1, appetisers: 1, appetizer: 1, small: 1, "small plates": 1, nibbles: 1,
  main: 2, mains: 2, "main course": 2, large: 2, sides: 2, side: 2,
  dessert: 3, desserts: 3, pudding: 3, puddings: 3, sweet: 3, sweets: 3,
};

export interface ImportedModifierGroup {
  name: string;
  minSelect: number;
  maxSelect: number;
  options: { name: string; priceDelta: number }[];
}

export interface ImportedItem {
  row: number;
  category: string;
  name: string;
  price: number;
  description: string | null;
  course: number | null;
  station: string | null;
  prepMinutes: number | null;
  allergens: Allergen[];
  dietary: string[];
  cost: number | null;
  vatRate: number | null;
  modifiers: ImportedModifierGroup[];
}

export interface ImportProblem {
  row: number;
  message: string;
}

export interface ImportResult {
  items: ImportedItem[];
  problems: ImportProblem[];
  /** Header names we didn't recognise (ignored). */
  ignoredColumns: string[];
}

/** RFC 4180-ish: quoted fields, doubled quotes, commas/newlines inside quotes. Detects tabs. */
export function parseDelimited(text: string): string[][] {
  const src = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const firstLine = src.split("\n", 1)[0] ?? "";
  const delim = (firstLine.match(/\t/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? "\t" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"' && field.trim() === "") {
      quoted = true;
      field = "";
    } else if (c === delim) {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ""));
}

const HEADERS: Record<string, keyof Omit<ImportedItem, "row">> = {
  category: "category", section: "category", group: "category",
  name: "name", item: "name", dish: "name", title: "name",
  price: "price", "price (£)": "price", "price £": "price", cost_price: "cost",
  description: "description", desc: "description", details: "description",
  course: "course",
  station: "station", "prep station": "station", printer: "station", route: "station",
  prep: "prepMinutes", "prep time": "prepMinutes", "prep minutes": "prepMinutes", "prep mins": "prepMinutes", minutes: "prepMinutes",
  allergens: "allergens", allergies: "allergens",
  dietary: "dietary", diet: "dietary", tags: "dietary",
  cost: "cost", "food cost": "cost",
  vat: "vatRate", "vat rate": "vatRate", "vat %": "vatRate",
  modifiers: "modifiers", options: "modifiers",
};

/** "£12.50", "12.5", "12" → pence. Negative allowed for modifier deltas. */
export function parseMoney(raw: string): number | null {
  const s = raw.trim().replace(/[£,\s]/g, "").replace(/^\+/, "");
  if (s === "") return null;
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ""] = s.replace("-", "").split(".");
  const pence = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  return s.startsWith("-") ? -pence : pence;
}

export function parseCourse(raw: string): number | null {
  const s = raw.trim().toLowerCase();
  if (s === "") return null;
  if (/^\d$/.test(s)) return Number(s);
  return COURSE_WORDS[s] ?? COURSE_WORDS[s.replace(/s$/, "")] ?? null;
}

export function parseAllergens(raw: string): { allergens: Allergen[]; unknown: string[] } {
  const found = new Set<Allergen>();
  const unknown: string[] = [];
  for (const part of raw.split(/[;,|/]/).map((p) => p.trim().toLowerCase()).filter(Boolean)) {
    if ((UK_ALLERGENS as readonly string[]).includes(part)) found.add(part as Allergen);
    else if (ALLERGEN_ALIASES[part]) found.add(ALLERGEN_ALIASES[part]);
    else if (part !== "none" && part !== "-") unknown.push(part);
  }
  return { allergens: [...found].sort(), unknown };
}

export function parseModifiers(raw: string): { groups: ImportedModifierGroup[]; errors: string[] } {
  const groups: ImportedModifierGroup[] = [];
  const errors: string[] = [];
  for (const spec of raw.split(";").map((s) => s.trim()).filter(Boolean)) {
    const m = spec.match(/^([^:]+):(.*)$/);
    if (!m) {
      errors.push(`modifier "${spec}" needs a name, a colon and options`);
      continue;
    }
    let head = m[1]!.trim();
    const required = head.endsWith("*");
    head = head.replace(/\*$/, "").trim();
    const max = head.match(/\(max\s*(\d+)\)\s*$/i);
    const name = head.replace(/\(max\s*\d+\)\s*$/i, "").trim();
    const options = m[2]!
      .split("|")
      .map((o) => o.trim())
      .filter(Boolean)
      .map((o) => {
        const pm = o.match(/^(.*?)\s*([+-]\s*£?\d+(?:\.\d{1,2})?)$/);
        return pm
          ? { name: pm[1]!.trim(), priceDelta: parseMoney(pm[2]!.replace(/\s/g, "")) ?? 0 }
          : { name: o, priceDelta: 0 };
      });
    if (!name || options.length === 0) {
      errors.push(`modifier "${spec}" has no options`);
      continue;
    }
    const maxSelect = Math.min(max ? Number(max[1]) : 1, options.length);
    groups.push({ name, minSelect: required ? 1 : 0, maxSelect: Math.max(1, maxSelect), options });
  }
  return { groups, errors };
}

export function parseMenuImport(text: string): ImportResult {
  const rows = parseDelimited(text);
  const problems: ImportProblem[] = [];
  if (rows.length < 2) {
    return { items: [], problems: [{ row: 1, message: "Needs a header row and at least one item" }], ignoredColumns: [] };
  }
  const header = rows[0]!.map((h) => h.trim().toLowerCase());
  const map = header.map((h) => HEADERS[h] ?? null);
  const ignoredColumns = rows[0]!.filter((h, i) => h.trim() !== "" && map[i] === null).map((h) => h.trim());
  for (const req of ["category", "name", "price"] as const) {
    if (!map.includes(req)) problems.push({ row: 1, message: `Missing a "${req}" column` });
  }
  if (problems.length) return { items: [], problems, ignoredColumns };

  const items: ImportedItem[] = [];
  const seen = new Set<string>();
  rows.slice(1).forEach((cells, idx) => {
    const row = idx + 2;
    const get = (k: keyof Omit<ImportedItem, "row">) => {
      const i = map.indexOf(k);
      return i >= 0 ? (cells[i] ?? "").trim() : "";
    };
    const errors: string[] = [];
    const category = get("category");
    const name = get("name");
    if (!category) errors.push("category is empty");
    if (!name) errors.push("name is empty");
    const price = parseMoney(get("price"));
    if (price === null || price < 0) errors.push(`price "${get("price")}" isn't a price`);

    const courseRaw = get("course");
    const course = parseCourse(courseRaw);
    if (courseRaw && course === null) errors.push(`course "${courseRaw}" isn't drinks/starters/mains/desserts or 0-9`);

    const prepRaw = get("prepMinutes");
    const prepMinutes = prepRaw ? Number(prepRaw.replace(/\s*(m|min|mins|minutes)$/i, "")) : null;
    if (prepRaw && (!Number.isInteger(prepMinutes) || prepMinutes! < 0 || prepMinutes! > 240)) {
      errors.push(`prep "${prepRaw}" should be whole minutes`);
    }

    const { allergens, unknown } = parseAllergens(get("allergens"));
    if (unknown.length) errors.push(`unknown allergen${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}`);

    const costRaw = get("cost");
    const cost = costRaw ? parseMoney(costRaw) : null;
    if (costRaw && (cost === null || cost < 0)) errors.push(`cost "${costRaw}" isn't a price`);

    const vatRaw = get("vatRate").replace("%", "");
    const vatRate = vatRaw ? Number(vatRaw) : null;
    if (vatRaw && (Number.isNaN(vatRate) || vatRate! < 0 || vatRate! > 100)) errors.push(`VAT "${vatRaw}" isn't a percentage`);

    const stationRaw = get("station").toLowerCase().replace(/\s+/g, "-");
    if (stationRaw && !/^[a-z][a-z0-9_-]*$/.test(stationRaw)) errors.push(`station "${get("station")}" should be a simple word`);

    const { groups, errors: modErrors } = parseModifiers(get("modifiers"));
    errors.push(...modErrors);

    const key = `${category.toLowerCase()}\u0000${name.toLowerCase()}`;
    if (category && name && seen.has(key)) errors.push(`"${name}" appears twice in ${category}`);
    seen.add(key);

    if (errors.length) {
      problems.push({ row, message: errors.join("; ") });
      return;
    }
    items.push({
      row,
      category,
      name,
      price: price!,
      description: get("description") || null,
      course,
      station: stationRaw || null,
      prepMinutes,
      allergens,
      dietary: get("dietary").split(/[;,|]/).map((d) => d.trim().toLowerCase()).filter(Boolean),
      cost,
      vatRate,
      modifiers: groups,
    });
  });
  return { items, problems, ignoredColumns };
}

/** Defaults for a new category, guessed from its name. */
export function guessCategoryDefaults(name: string): { course: number; station: string } {
  const n = name.toLowerCase();
  const drinky = /(drink|wine|beer|cocktail|spirit|soft|coffee|tea|bar|gin|whisk|cider|fizz|champagne|juice|mocktail|lager|ale|bubbles)/;
  if (drinky.test(n)) return { course: 0, station: "bar" };
  if (/(dessert|pudding|sweet|cake)/.test(n)) return { course: 3, station: "kitchen" };
  if (/(starter|small|snack|nibble|appeti|bread|tapas)/.test(n)) return { course: 1, station: "kitchen" };
  return { course: 2, station: "kitchen" };
}
