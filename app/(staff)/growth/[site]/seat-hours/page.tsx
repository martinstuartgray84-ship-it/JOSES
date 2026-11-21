import { fmt, heat, parties } from "@/src/growth/engine";
import { growthCtx, one, withPeriod, type SP } from "../../ctx";
import { Head, HeatGrid, NoData, Seg, Stat } from "../../ui";

export default async function SeatHours({ params, searchParams }: { params: Promise<{ site: string }>; searchParams: SP }) {
  const { site: slug } = await params;
  const c = await growthCtx(slug, searchParams, "/seat-hours");
  if (!c.model || !c.period) return (<><Head title="Seat-hours" /><NoData slug={slug} /></>);
  const { model: m, period: p } = c;
  const mode = one((await searchParams).show) === "occ" ? "occ" : "rev";
  const h = heat(m, p.from, p.to, c.settings.seats);
  const base = `/growth/${slug}/seat-hours`;
  return (
    <>
      <Head title="Seat-hours">
        Revenue per available seat-hour (RevPASH) is net sales divided by seats times hours open. It shows where the room earns and where it idles. {p.label}, {c.settings.seats} seats.
      </Head>
      <section className="box">
        <div className="gbar">
          <h2>{mode === "rev" ? "RevPASH in £, by day and hour" : "Seat occupancy, by day and hour"}</h2>
          <Seg value={mode} options={[{ key: "rev", label: "RevPASH", href: withPeriod(base, c.weeks) }, { key: "occ", label: "Occupancy", href: withPeriod(base, c.weeks, { show: "occ" }) }]} />
        </div>
        <HeatGrid heat={h} mode={mode} />
        <p className="gnote">Each check is spread across the hours it occupied the table. Occupancy counts seats filled, so a two at a four-top reads as half.</p>
      </section>
      <div className="gtiles">
        <Stat label="Peak cell" value={fmt("money2", h.peak)} />
        <Stat label="Fri and Sat, 7 to 9pm" value={fmt("money2", h.peakFriSat)} />
        <Stat label="Fri and Sat, 10pm to midnight" value={fmt("money2", h.lateFriSat)} />
      </div>
      <section className="box">
        <h2>Party size, turn time and spend</h2>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr><th>Party</th><th className="right">Share of checks</th><th className="right">Covers</th><th className="right">Turn, minutes</th><th className="right">Spend per head</th></tr>
            </thead>
            <tbody>
              {parties(m, p.from, p.to).map((b) => (
                <tr key={b.label}>
                  <td>{b.label}</td>
                  <td className="right num">{fmt("pct0", b.share)}</td>
                  <td className="right num">{fmt("int", b.covers)}</td>
                  <td className="right num">{fmt("dec1", b.turn)}</td>
                  <td className="right num">{fmt("money2", b.sph)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
