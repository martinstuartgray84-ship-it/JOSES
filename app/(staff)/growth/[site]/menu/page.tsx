import { fmt, menu, type MenuClass } from "@/src/growth/engine";
import { MenuScatter } from "../../Charts";
import { growthCtx, one, withPeriod, type SP } from "../../ctx";
import { Head, NoData, Seg } from "../../ui";

const CLS: Record<MenuClass, { tone: string; action: string }> = {
  Star: { tone: "good", action: "Protect. Keep the recipe and feature it." },
  "Plough horse": { tone: "warn", action: "Popular, thin margin. Reprice or re-cost." },
  Puzzle: { tone: "info", action: "Earns well, sells little. Reposition, rename, have servers suggest it." },
  Dog: { tone: "bad", action: "Cut it, or rework it." },
};

export default async function MenuView({ params, searchParams }: { params: Promise<{ site: string }>; searchParams: SP }) {
  const { site: slug } = await params;
  const c = await growthCtx(slug, searchParams, "/menu");
  if (!c.model || !c.period) return (<><Head title="Menu" /><NoData slug={slug} /></>);
  const { model: m, period: p } = c;
  if (!m.hasItems)
    return (<><Head title="Menu">Menu engineering.</Head><p className="box">This view needs the items file. Add it under Data.</p></>);
  const group = one((await searchParams).group) === "drink" ? "drink" : "food";
  const list = menu(m, p.from, p.to).filter((o) => o.group === group);
  const base = `/growth/${slug}/menu`;
  return (
    <>
      <Head title="Menu">
        Each item is placed by how often it sells and how much it earns per sale, against the average for {group}. {p.label}.
      </Head>
      {!m.hasCost && <p className="box gwarn">No unit costs in the items file, so margin equals price. Add unit_cost for a true picture.</p>}
      <section className="box">
        <div className="gbar">
          <h2>Popularity against margin per sale</h2>
          <Seg value={group} options={[{ key: "food", label: "Food", href: withPeriod(base, c.weeks) }, { key: "drink", label: "Drinks", href: withPeriod(base, c.weeks, { group: "drink" }) }]} />
        </div>
        {list.length ? <MenuScatter group={group} points={list.map((o) => ({ item: o.item, qty: o.qty, margin: o.margin, cls: o.cls }))} thr={list[0]!.thr} avgMargin={list[0]!.avgMargin} /> : <p className="viz-note">No {group} items in this period.</p>}
      </section>
      <section className="box">
        <h2>Items, by total contribution</h2>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr><th>Item</th><th className="right">Sold</th><th className="right">Price</th><th className="right">Margin per sale</th><th className="right">Contribution</th><th>Class and action</th></tr>
            </thead>
            <tbody>
              {list.map((o) => (
                <tr key={o.item}>
                  <td>{o.item}<div className="small muted">{o.cat}</div></td>
                  <td className="right num">{fmt("int", o.qty)}</td>
                  <td className="right num">{fmt("money2", o.price)}</td>
                  <td className="right num">{m.hasCost ? fmt("money2", o.margin) : "No cost"}</td>
                  <td className="right num">{fmt("money0", o.contribution)}</td>
                  <td><span className={`chip ${CLS[o.cls].tone}`}>{o.cls}</span><div className="small muted">{CLS[o.cls].action}</div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
