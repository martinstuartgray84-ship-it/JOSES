import Link from "next/link";
import { fmt, servers } from "@/src/growth/engine";
import { canSeeServers, growthCtx, type SP } from "../../ctx";
import { Head, NoData, Stat } from "../../ui";

export default async function Team({ params, searchParams }: { params: Promise<{ site: string }>; searchParams: SP }) {
  const { site: slug } = await params;
  const c = await growthCtx(slug, searchParams, "/team");
  if (!c.model || !c.period) return (<><Head title="Team" /><NoData slug={slug} /></>);
  const { model: m, period: p } = c;
  const sv = servers(m, p.from, p.to);
  const allowed = await canSeeServers(c.settings, c.site.companyId);
  const top = sv.list[0]?.sph || 1;
  return (
    <>
      <Head title="Team">Spend per head and attach rates by server. Use it for coaching and for deciding who works the peak. {p.label}.</Head>
      <div className="gtiles">
        <Stat label="Median spend per head" value={fmt("money2", sv.median)} />
        <Stat label="Prize from lifting the lower half to the median" value={fmt("money0", sv.gapPerWeek)} hint="a week" />
      </div>
      {!allowed ? (
        <section className="box gwarn">
          <p style={{ margin: 0 }}>
            <strong>Figures for individual servers are limited to managers at this site.</strong> Sign in on the <Link href={`/pos/${slug}`}>till</Link> with a manager PIN to see them here, or change who may see them under <Link href={`/growth/${slug}/settings`}>Settings</Link>.
          </p>
        </section>
      ) : (
        <section className="box">
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr><th>Server</th><th className="right">Covers</th><th className="right">Spend per head</th><th className="right">Drinks per cover</th><th className="right">Starters per cover</th><th className="right">Desserts per cover</th><th className="right">Index, median 100</th></tr>
              </thead>
              <tbody>
                {sv.list.map((o) => (
                  <tr key={o.server}>
                    <td>{o.server}</td>
                    <td className="right num">{fmt("int", o.covers)}</td>
                    <td className="right num"><span className="gbarcell"><i style={{ width: Math.round(((o.sph ?? 0) / top) * 70) }} />{fmt("money2", o.sph)}</span></td>
                    <td className="right num">{fmt("dec2", o.dpc)}</td>
                    <td className="right num">{fmt("dec2", o.starter)}</td>
                    <td className="right num">{fmt("dec2", o.dessert)}</td>
                    <td className="right num"><span className={`chip ${(o.sph ?? 0) >= sv.median ? "good" : "bad"}`}>{sv.median ? Math.round(((o.sph ?? 0) / sv.median) * 100) : "–"}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="gnote">Raw comparison. Sections, shifts and party sizes differ between servers, so check the rota before drawing conclusions about a person.</p>
        </section>
      )}
    </>
  );
}
