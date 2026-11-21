import { attention, dayparts, fmt, heat, modelSource, tiles, weekly } from "@/src/growth/engine";
import { Trend } from "../../Charts";
import { canSeeServers, growthCtx, type SP } from "../../ctx";
import { Head, NoData, Tiles } from "../../ui";

export default async function Scoreboard({ params, searchParams }: { params: Promise<{ site: string }>; searchParams: SP }) {
  const { site: slug } = await params;
  const c = await growthCtx(slug, searchParams, "/scoreboard");
  if (!c.model || !c.period) return (<><Head title="Scoreboard" /><NoData slug={slug} what="The scoreboard" /></>);
  const { model: m, period: p } = c;
  const h = heat(m, p.from, p.to, c.settings.seats);
  const s = modelSource(m, c.settings.seats);
  const showServers = await canSeeServers(c.settings, c.site.companyId);
  // The server spread names individuals, so it follows the server-figures setting.
  const flags = attention(m, p.from, p.to, h).filter((f) => showServers || !f.text.startsWith("Spend per head runs"));
  const wk = weekly(m);
  const labels = wk.map((w) => w.label);
  const weeks = (p.to - p.from + 1) / 7;
  return (
    <>
      <Head title="Scoreboard">
        {p.label}
        {p.prior ? `, compared with the ${c.weeks} weeks before.` : "."} {c.settings.seats} seats.
      </Head>
      <Tiles tiles={tiles(s, p)} />
      <div className="gcols">
        <section className="box">
          <h2>Net sales, weekly</h2>
          <Trend title="Net sales" labels={labels} values={wk.map((w) => w.sales)} fmt="money0" zero />
        </section>
        <section className="box">
          <h2>What needs attention</h2>
          <ul className="gflags">
            {flags.map((f, i) => (
              <li key={i} className={f.level}>{f.text}</li>
            ))}
          </ul>
        </section>
      </div>
      <div className="gcols">
        <section className="box">
          <h2>Spend per head, weekly</h2>
          <Trend title="Spend per head" labels={labels} values={wk.map((w) => w.sph)} fmt="money2" compact />
        </section>
        <section className="box">
          <h2>Drinks per cover, weekly</h2>
          {m.hasItems ? <Trend title="Drinks per cover" labels={labels} values={wk.map((w) => w.dpc)} fmt="dec2" compact /> : <p className="viz-note">Needs the items file.</p>}
        </section>
        <section className="box">
          <h2>Turn time in minutes, weekly</h2>
          <Trend title="Turn time" labels={labels} values={wk.map((w) => w.turn)} fmt="dec1" color="var(--series-2)" compact />
        </section>
      </div>
      <section className="box">
        <h2>By part of the day</h2>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr><th>Part of day</th><th className="right">Sales per week</th><th className="right">Share</th><th className="right">Spend per head</th><th className="right">Drinks share</th></tr>
            </thead>
            <tbody>
              {dayparts(m, p.from, p.to).map((d) => (
                <tr key={d.label}>
                  <td>{d.label}</td>
                  <td className="right num">{fmt("money0", d.sales / weeks)}</td>
                  <td className="right num">{fmt("pct1", d.share)}</td>
                  <td className="right num">{fmt("money2", d.sph)}</td>
                  <td className="right num">{fmt("pct0", d.drinkShare)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
