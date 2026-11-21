import { channels, fmt, summary, weekly } from "@/src/growth/engine";
import { Trend } from "../../Charts";
import { growthCtx, type SP } from "../../ctx";
import { Head, NoData, Stat } from "../../ui";

export default async function Bookings({ params, searchParams }: { params: Promise<{ site: string }>; searchParams: SP }) {
  const { site: slug } = await params;
  const c = await growthCtx(slug, searchParams, "/bookings");
  if (!c.model || !c.period) return (<><Head title="Bookings" /><NoData slug={slug} /></>);
  const { model: m, period: p } = c;
  if (!m.hasBookings)
    return (<><Head title="Bookings">Channels, no-shows and lead times.</Head><p className="box">This view needs the bookings file. Add it under Data.</p></>);
  const s = summary(m, p.from, p.to);
  const wk = weekly(m);
  return (
    <>
      <Head title="Bookings">Where bookings come from and how many fail to arrive. {p.label}.</Head>
      <div className="gtiles">
        <Stat label="Bookings" value={fmt("int", s.bookings)} />
        <Stat label="No-show rate" value={fmt("pct1", s.noShow)} hint="No-shows ÷ (no-shows + seated)" />
        <Stat label="Cancellation rate" value={fmt("pct1", s.cancelRate)} />
      </div>
      <div className="gcols">
        <section className="box">
          <h2>No-show rate, weekly</h2>
          <Trend title="No-show rate" labels={wk.map((w) => w.label)} values={wk.map((w) => w.noShow)} fmt="pct1" zero color="var(--series-2)" />
        </section>
        <section className="box">
          <h2>By channel</h2>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr><th>Channel</th><th className="right">Bookings</th><th className="right">Covers seated</th><th className="right">No-show rate</th><th className="right">Lead time, days</th></tr>
              </thead>
              <tbody>
                {channels(m, p.from, p.to).map((o) => (
                  <tr key={o.channel}>
                    <td>{o.channel}</td>
                    <td className="right num">{fmt("int", o.total)}</td>
                    <td className="right num">{fmt("int", o.covers)}</td>
                    <td className="right num">{fmt("pct1", o.noShowRate)}</td>
                    <td className="right num">{fmt("dec1", o.avgLead)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </>
  );
}
