"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import type { MenuCategory, MenuItem, Station } from "@/src/server/menu";
import { parseMenuImport, parseMoney, UK_ALLERGENS } from "@/src/menu/import";
import { formatMoney } from "@/src/pos/totals";
import { addCategoryAction, importMenuAction, saveItemAction, set86Action, setStockAction } from "../actions";

export const COURSE_NAMES = ["Drinks", "Starters", "Mains", "Desserts", "Course 4", "Course 5", "Course 6", "Course 7", "Course 8", "Course 9"];

/** Gross profit % on the VAT-exclusive price. */
function gp(price: number, cost: number | null, vatRate: number): number | null {
  if (cost === null || price <= 0) return null;
  const net = price / (1 + vatRate / 100);
  return Math.round(((net - cost) / net) * 100);
}

const TEMPLATE = [
  "category,name,price,description,course,station,prep,allergens,dietary,cost,modifiers",
  'Starters,Soup of the day,7.00,"With sourdough",starters,kitchen,6,"celery, gluten",vegetarian,1.20,',
  'Mains,Ribeye 10oz,28.00,"28-day aged, chips",mains,grill,14,milk,,9.80,"Temperature*: Rare | Medium rare | Medium | Well done; Sauce: Peppercorn +2 | Béarnaise +2"',
  "Drinks,House red (175ml),7.50,,drinks,bar,1,sulphites,vegan,2.10,",
].join("\n");

export default function MenuEditor({
  site,
  menu,
  stations,
}: {
  site: { slug: string; name: string };
  menu: MenuCategory[];
  stations: Station[];
}) {
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<MenuItem | "new" | null>(null);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  const q = query.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      menu
        .map((c) => ({
          ...c,
          items: c.items.filter((i) => !q || i.name.toLowerCase().includes(q) || c.name.toLowerCase().includes(q)),
        }))
        .filter((c) => c.items.length || !q),
    [menu, q],
  );
  const counts = useMemo(() => {
    const all = menu.flatMap((c) => c.items).filter((i) => i.active);
    return { items: all.length, off: all.filter((i) => !i.available).length };
  }, [menu]);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (!r.ok) setError(r.error ?? "Something went wrong");
      else router.refresh();
    });

  return (
    <main className="page menu-page">
      <div className="page-head">
        <div>
          <h1>Menu</h1>
          <p className="muted small" style={{ margin: 0 }}>
            {counts.items} items · {counts.off > 0 ? `${counts.off} off at ${site.name}` : `everything on at ${site.name}`}
          </p>
        </div>
        <div className="btn-row">
          <input
            type="search"
            placeholder="Find an item"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Find an item"
            style={{ width: 200 }}
          />
          <button type="button" onClick={() => setImporting(true)}>
            Import menu
          </button>
          <button type="button" className="primary" onClick={() => setEditing("new")} disabled={menu.length === 0}>
            Add item
          </button>
        </div>
      </div>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {menu.length === 0 && (
        <section className="box empty-menu">
          <h2>No menu yet</h2>
          <p className="muted">
            The quickest way in is a spreadsheet: one row per dish with its category, name and price. Prep time, station,
            allergens, cost and options are optional.
          </p>
          <div className="btn-row">
            <button type="button" className="primary" onClick={() => setImporting(true)}>
              Import a spreadsheet
            </button>
          </div>
        </section>
      )}

      {filtered.map((cat) => (
        <section key={cat.id} className={`box menu-cat ${cat.active ? "" : "inactive"}`}>
          <header>
            <h2>{cat.name}</h2>
            <span className="muted small">
              {COURSE_NAMES[cat.defaultCourse]} · {stations.find((s) => s.code === cat.defaultStation)?.name ?? cat.defaultStation}
            </span>
          </header>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Item</th>
                  <th className="right">Price</th>
                  <th className="right">GP</th>
                  <th>Goes to</th>
                  <th className="right">Prep</th>
                  <th>Stock</th>
                  <th>On / off</th>
                </tr>
              </thead>
              <tbody>
                {cat.items.map((i) => {
                  const margin = gp(i.price, i.cost, i.vatRate);
                  return (
                    <tr key={i.id} className={i.active && !i.hidden ? "" : "dim"}>
                      <td>
                        <button type="button" className="link item-name" onClick={() => setEditing(i)}>
                          {i.name}
                        </button>
                        <div className="item-tags">
                          {!i.active && <span className="chip">Archived</span>}
                          {i.hidden && <span className="chip">Not sold here</span>}
                          {i.modifierGroups.length > 0 && (
                            <span className="chip">{i.modifierGroups.map((g) => g.name).join(", ")}</span>
                          )}
                          {i.allergens.map((a) => (
                            <span key={a} className="chip warn">
                              {a}
                            </span>
                          ))}
                          {i.dietary.map((d) => (
                            <span key={d} className="chip good">
                              {d}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="right num">
                        {formatMoney(i.price)}
                        {i.price !== i.basePrice && <div className="small muted">usually {formatMoney(i.basePrice)}</div>}
                      </td>
                      <td className={`right num ${margin !== null && margin < 65 ? "low-gp" : ""}`}>
                        {margin === null ? <span className="muted">–</span> : `${margin}%`}
                      </td>
                      <td>
                        {stations.find((s) => s.code === i.station)?.name ?? i.station}
                        <div className="small muted">{COURSE_NAMES[i.course]}</div>
                      </td>
                      <td className="right num">{i.prepMinutes}m</td>
                      <td>
                        <StockInput
                          value={i.stockRemaining}
                          disabled={pending}
                          onSave={(v) => run(() => setStockAction(site.slug, i.id, v))}
                        />
                      </td>
                      <td>
                        <button
                          type="button"
                          className={`toggle ${i.eightySixed || i.stockRemaining === 0 ? "off" : "on"}`}
                          aria-pressed={!(i.eightySixed || i.stockRemaining === 0)}
                          disabled={pending || !i.active || i.hidden}
                          onClick={() => run(() => set86Action(site.slug, i.id, !(i.eightySixed || i.stockRemaining === 0)))}
                        >
                          {i.eightySixed || i.stockRemaining === 0 ? "86'd" : "On"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {cat.items.length === 0 && (
                  <tr>
                    <td colSpan={7} className="muted">
                      No items yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      {menu.length > 0 && <AddCategory stations={stations} disabled={pending} onAdd={(n, c, s) => run(() => addCategoryAction(site.slug, n, c, s))} />}

      {editing && (
        <ItemDialog
          item={editing === "new" ? null : editing}
          menu={menu}
          stations={stations}
          siteName={site.name}
          onClose={() => setEditing(null)}
          onSave={async (input) => {
            const r = await saveItemAction(site.slug, input);
            if (r.ok) {
              setEditing(null);
              router.refresh();
            }
            return r;
          }}
        />
      )}

      {importing && (
        <ImportDialog
          onClose={() => setImporting(false)}
          onImport={async (text) => {
            const r = await importMenuAction(site.slug, text);
            if (r.ok) router.refresh();
            return r;
          }}
        />
      )}
    </main>
  );
}

function StockInput(props: { value: number | null; disabled: boolean; onSave: (v: number | null) => void }) {
  const [v, setV] = useState(props.value === null ? "" : String(props.value));
  const commit = () => {
    const next = v.trim() === "" ? null : Number(v);
    if (next !== null && (!Number.isInteger(next) || next < 0)) return setV(props.value === null ? "" : String(props.value));
    if (next !== props.value) props.onSave(next);
  };
  return (
    <input
      className="stock"
      inputMode="numeric"
      placeholder="∞"
      aria-label="Portions left"
      value={v}
      disabled={props.disabled}
      onChange={(e) => setV(e.target.value.replace(/\D/g, ""))}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
    />
  );
}

function AddCategory(props: { stations: Station[]; disabled: boolean; onAdd: (name: string, course: number, station: string) => void }) {
  const [name, setName] = useState("");
  const [course, setCourse] = useState(2);
  const [station, setStation] = useState(props.stations.find((s) => s.kind === "kitchen")?.code ?? "kitchen");
  return (
    <form
      className="box add-cat"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) {
          props.onAdd(name, course, station);
          setName("");
        }
      }}
    >
      <label>
        New category
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sides" />
      </label>
      <label>
        Course
        <select value={course} onChange={(e) => setCourse(Number(e.target.value))}>
          {COURSE_NAMES.slice(0, 4).map((n, i) => (
            <option key={n} value={i}>
              {n}
            </option>
          ))}
        </select>
      </label>
      <label>
        Goes to
        <select value={station} onChange={(e) => setStation(e.target.value)}>
          {props.stations
            .filter((s) => s.kind !== "pass")
            .map((s) => (
              <option key={s.code} value={s.code}>
                {s.name}
              </option>
            ))}
        </select>
      </label>
      <button type="submit" disabled={props.disabled || !name.trim()}>
        Add category
      </button>
    </form>
  );
}

function ItemDialog(props: {
  item: MenuItem | null;
  menu: MenuCategory[];
  stations: Station[];
  siteName: string;
  onClose: () => void;
  onSave: (input: Parameters<typeof saveItemAction>[1]) => Promise<{ ok: boolean; error?: string }>;
}) {
  const i = props.item;
  const [categoryId, setCategoryId] = useState(i?.categoryId ?? props.menu[0]!.id);
  const cat = props.menu.find((c) => c.id === categoryId)!;
  const [name, setName] = useState(i?.name ?? "");
  const [description, setDescription] = useState(i?.description ?? "");
  const [price, setPrice] = useState(i ? (i.basePrice / 100).toFixed(2) : "");
  const [cost, setCost] = useState(i?.cost != null ? (i.cost / 100).toFixed(2) : "");
  const [vat, setVat] = useState(String(i?.vatRate ?? 20));
  const [course, setCourse] = useState<string>(i ? String(i.course) : "");
  const [station, setStation] = useState<string>(i?.station ?? "");
  const [prep, setPrep] = useState(String(i?.prepMinutes ?? 10));
  const [allergens, setAllergens] = useState<string[]>(i?.allergens ?? []);
  const [dietary, setDietary] = useState((i?.dietary ?? []).join(", "));
  const [active, setActive] = useState(i?.active ?? true);
  const [sitePrice, setSitePrice] = useState(i && i.price !== i.basePrice ? (i.price / 100).toFixed(2) : "");
  const [siteHidden, setSiteHidden] = useState(i?.hidden ?? false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const pricePence = parseMoney(price);
  const costPence = cost ? parseMoney(cost) : null;
  const margin = pricePence !== null ? gp(pricePence, costPence, Number(vat) || 0) : null;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (pricePence === null || pricePence < 0) return setError("Enter a price like 12.50");
    if (cost && (costPence === null || costPence < 0)) return setError("Enter a cost like 3.20, or leave it blank");
    const sp = sitePrice ? parseMoney(sitePrice) : null;
    if (sitePrice && (sp === null || sp < 0)) return setError("Enter a site price like 13.00, or leave it blank");
    setSaving(true);
    const r = await props.onSave({
      id: i?.id,
      categoryId,
      name,
      description: description || null,
      price: pricePence,
      cost: costPence,
      vatRate: Number(vat),
      course: course === "" ? null : Number(course),
      station: station || null,
      prepMinutes: Number(prep) || 0,
      allergens,
      dietary: dietary.split(",").map((d) => d.trim().toLowerCase()).filter(Boolean),
      active,
      sitePrice: sp,
      siteHidden,
    });
    setSaving(false);
    if (!r.ok) setError(r.error ?? "Couldn't save");
  }

  return (
    <div className="scrim" onClick={(e) => e.target === e.currentTarget && props.onClose()}>
      <form className="dialog item-dialog" onSubmit={save}>
        <h2>{i ? `Edit ${i.name}` : "New item"}</h2>
        <div className="row">
          <label>
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} />
          </label>
          <label>
            Category
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              {props.menu.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label>
          Description
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} maxLength={500} />
        </label>
        <div className="row">
          <label>
            Price (£, inc VAT)
            <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" required />
          </label>
          <label>
            Cost (£)
            <input value={cost} onChange={(e) => setCost(e.target.value)} inputMode="decimal" placeholder="optional" />
          </label>
          <label>
            VAT %
            <select value={vat} onChange={(e) => setVat(e.target.value)}>
              <option value="20">20</option>
              <option value="5">5</option>
              <option value="0">0</option>
            </select>
          </label>
        </div>
        {margin !== null && (
          <p className={`small ${margin < 65 ? "error" : "muted"}`} style={{ margin: 0 }}>
            Gross profit {margin}% after VAT{margin < 65 ? ": below the usual 65–70% target" : ""}
          </p>
        )}
        <div className="row">
          <label>
            Course
            <select value={course} onChange={(e) => setCourse(e.target.value)}>
              <option value="">{COURSE_NAMES[cat.defaultCourse]} (category)</option>
              {COURSE_NAMES.slice(0, 4).map((n, idx) => (
                <option key={n} value={idx}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label>
            Goes to
            <select value={station} onChange={(e) => setStation(e.target.value)}>
              <option value="">
                {props.stations.find((s) => s.code === cat.defaultStation)?.name ?? cat.defaultStation} (category)
              </option>
              {props.stations
                .filter((s) => s.kind !== "pass")
                .map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Prep (minutes)
            <input value={prep} onChange={(e) => setPrep(e.target.value.replace(/\D/g, ""))} inputMode="numeric" />
          </label>
        </div>
        <fieldset className="allergen-grid">
          <legend>Allergens</legend>
          {UK_ALLERGENS.map((a) => (
            <label key={a} className="check">
              <input
                type="checkbox"
                checked={allergens.includes(a)}
                onChange={(e) => setAllergens((cur) => (e.target.checked ? [...cur, a] : cur.filter((x) => x !== a)))}
              />
              {a}
            </label>
          ))}
        </fieldset>
        <label>
          Dietary (comma separated)
          <input value={dietary} onChange={(e) => setDietary(e.target.value)} placeholder="vegan, gf" />
        </label>
        <fieldset className="site-box">
          <legend>At {props.siteName}</legend>
          <div className="row">
            <label>
              Different price here (£)
              <input value={sitePrice} onChange={(e) => setSitePrice(e.target.value)} inputMode="decimal" placeholder="same" />
            </label>
            <label className="check">
              <input type="checkbox" checked={siteHidden} onChange={(e) => setSiteHidden(e.target.checked)} />
              Not sold at this site
            </label>
          </div>
        </fieldset>
        <label className="check">
          <input type="checkbox" checked={!active} onChange={(e) => setActive(!e.target.checked)} />
          Archive (off the menu at every site)
        </label>
        {i && i.modifierGroups.length > 0 && (
          <p className="small muted" style={{ margin: 0 }}>
            Options: {i.modifierGroups.map((g) => `${g.name} (${g.options.map((o) => o.name).join(", ")})`).join("; ")}. Change
            options by re-importing the item.
          </p>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" onClick={props.onClose}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}

function ImportDialog(props: {
  onClose: () => void;
  onImport: (text: string) => Promise<{ ok: boolean; error?: string; data?: { itemsCreated: number; itemsUpdated: number; categoriesCreated: number; skipped: number } }>;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const preview = useMemo(() => (text.trim() ? parseMenuImport(text) : null), [text]);
  const categories = preview ? [...new Set(preview.items.map((i) => i.category))] : [];

  return (
    <div className="scrim" onClick={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className="dialog import-dialog">
        <h2>Import a menu</h2>
        <p className="small muted" style={{ margin: 0 }}>
          Paste from Excel or Google Sheets, or choose a CSV file. Needs <strong>category</strong>, <strong>name</strong> and{" "}
          <strong>price</strong> columns. Items already on the menu (same category and name) are updated.{" "}
          <a href={`data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE)}`} download="menu-template.csv">
            Download a template
          </a>
        </p>
        <input
          type="file"
          accept=".csv,.tsv,.txt,text/csv"
          aria-label="Choose a CSV file"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f) setText(await f.text());
          }}
        />
        <textarea
          rows={8}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setDone(null);
          }}
          placeholder={TEMPLATE}
          aria-label="Menu rows"
          className="mono"
        />
        {preview && (
          <div className="import-preview">
            <p style={{ margin: 0 }}>
              <strong>{preview.items.length}</strong> item{preview.items.length === 1 ? "" : "s"} in {categories.length}{" "}
              categor{categories.length === 1 ? "y" : "ies"}
              {preview.problems.length > 0 && (
                <>
                  {" "}
                  · <span className="error">{preview.problems.length} row(s) will be skipped</span>
                </>
              )}
              {preview.ignoredColumns.length > 0 && (
                <span className="muted"> · ignoring columns: {preview.ignoredColumns.join(", ")}</span>
              )}
            </p>
            {preview.problems.length > 0 && (
              <ul className="problems">
                {preview.problems.slice(0, 20).map((p) => (
                  <li key={p.row}>
                    Row {p.row}: {p.message}
                  </li>
                ))}
              </ul>
            )}
            {preview.items.length > 0 && (
              <div className="tbl-wrap preview-tbl">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Category</th>
                      <th>Item</th>
                      <th className="right">Price</th>
                      <th>Allergens</th>
                      <th>Options</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.items.slice(0, 50).map((i) => (
                      <tr key={i.row}>
                        <td>{i.category}</td>
                        <td>{i.name}</td>
                        <td className="right num">{formatMoney(i.price)}</td>
                        <td className="small">{i.allergens.join(", ")}</td>
                        <td className="small">{i.modifiers.map((m) => m.name).join(", ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {done && (
          <p className="ok" role="status">
            {done}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" onClick={props.onClose}>
            {done ? "Done" : "Cancel"}
          </button>
          <button
            type="button"
            className="primary"
            disabled={busy || !preview || preview.items.length === 0}
            onClick={async () => {
              setBusy(true);
              setError(null);
              const r = await props.onImport(text);
              setBusy(false);
              if (!r.ok) setError(r.error ?? "Import failed");
              else if (r.data) {
                setDone(
                  `Imported: ${r.data.itemsCreated} new, ${r.data.itemsUpdated} updated` +
                    (r.data.categoriesCreated ? `, ${r.data.categoriesCreated} new categories` : "") +
                    (r.data.skipped ? `. ${r.data.skipped} rows skipped.` : "."),
                );
                setText("");
              }
            }}
          >
            {busy ? "Importing…" : `Import ${preview?.items.length ?? 0} items`}
          </button>
        </div>
      </div>
    </div>
  );
}
