import Link from "next/link";
import { db } from "@/src/server/db";
import { emailConfigured } from "@/src/server/email";
import { getSettings, loadStored } from "@/src/server/growth";
import { listScorecards } from "@/src/server/growth-programme";
import { fmt, fmtDay, isoDay, pctChange, weekOf } from "@/src/growth/engine";
import ActionForm from "../../ActionForm";
import { buildScorecardAction, emailScorecardAction } from "../../actions";
import { growthSite, one, type SP } from "../../ctx";
import { Delta, Head } from "../../ui";

export default async function ScorecardPage({ params, searchParams }: { params: Promise<{ site: string }>; searchParams: SP }) {
  const { site: slug } = await params;
  const site = await growthSite(slug, "/scorecard");
  const sql = db();
  const [cards, stored, settings, sp] = await Promise.all([listScorecards(sql, site.id), loadStored(sql, site.id), getSettings(sql, site.id), searchParams]);
  const card = cards.find((c) => c.weekStart === one(sp.week)) ?? cards[0];
  // Weeks with sales loaded, newest first, for building or rebuilding a card.
  const weeks = stored ? [...new Set(stored.days.filter((d) => d.checks > 0).map((d) => weekOf(d.day)))].sort((a, b) => b - a).slice(0, 26) : [];
  const p = card?.payload;
  return (
    <>
      <Head title="Weekly scorecard">Built every Monday at 07:00 for the trading week before, once that week&rsquo;s sales are loaded, and emailed to the managers. This is what the weekly trading review reads.</Head>
      {p && card ? (
        <>
          <section className="box">
            <div className="gbar">
              <h2>{site.name}: {p.label}</h2>
              <div className="btn-row noprint">
                <ActionForm className="ginline" action={emailScorecardAction.bind(null, slug, card.weekStart)}><button className="small">Email to managers</button></ActionForm>
              </div>
            </div>
            <div className="tbl-wrap">
              <table className="tbl">
                <thead><tr><th>Measure</th><th className="right">This week</th><th className="right">Week before</th><th className="right">On prior week</th><th className="right">Four-week average</th><th className="right">On four-week average</th></tr></thead>
                <tbody>
                  {p.tiles.map((t) => (
                    <tr key={t.key}>
                      <td>{t.label}</td>
                      <td className="right num"><strong>{fmt(t.fmt, t.value)}</strong></td>
                      <td className="right num">{fmt(t.fmt, t.priorWeek)}</td>
                      <td className="right"><Delta change={t.onPriorWeek} better={t.better} label="" /></td>
                      <td className="right num">{fmt(t.fmt, t.fourWeek)}</td>
                      <td className="right"><Delta change={t.onFourWeek} better={t.better} label="" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="gnote">
              {card.emailedAt ? `Emailed to ${card.emailedTo.join(", ")} on ${card.emailedAt.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: site.timezone })}.` : "Not emailed yet."}
              {!emailConfigured() && " Email delivery is not set up on this deployment, so sends are recorded but not delivered."}
              {settings.scorecardEmails.length === 0 && <> No manager addresses are saved: add them under <Link href={`/growth/${slug}/settings`}>Settings</Link>.</>}
            </p>
          </section>
          <div className="gcols">
            <section className="box">
              <h2>Live tests</h2>
              {p.liveTests.length === 0 ? <p className="muted" style={{ margin: 0 }}>None live that week.</p> : (
                <ul className="gflags">
                  {p.liveTests.map((t) => (
                    <li key={t.name} className={t.tone === "good" ? "ok" : t.tone === "bad" ? "hot" : ""}>
                      <strong>{t.name}</strong>: {t.verdict}{t.change != null && `, ${pctChange(t.change)} on ${t.metric.toLowerCase()}`}
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section className="box">
              <h2>Gains banked this week</h2>
              {p.gainsThisWeek.length === 0 ? <p className="muted" style={{ margin: 0 }}>None this week.</p> : (
                <ul className="gflags">
                  {p.gainsThisWeek.map((g) => (
                    <li key={g.name} className="ok"><strong>{g.name}</strong>: {pctChange(g.changePct / 100)}{g.yearlyValue != null && `, about ${fmt("money0", g.yearlyValue)} a year`}</li>
                  ))}
                </ul>
              )}
              <p className="gnote">Banked so far: {fmt("money0", p.bankedTotal)} a year.</p>
            </section>
          </div>
        </>
      ) : (
        <p className="box" style={{ margin: 0 }}>No scorecard yet. {weeks.length ? "Build one for any week with sales loaded." : "Load till data first."}</p>
      )}
      <div className="gcols noprint">
        {weeks.length > 0 && (
          <section className="box">
            <h2>Build or rebuild a week</h2>
            <ActionForm action={buildScorecardAction.bind(null, slug)} className="gform" keep>
              <label>
                Week
                <select name="week" defaultValue={isoDay(weeks[0]!)}>
                  {weeks.map((w) => (<option key={w} value={isoDay(w)}>{fmtDay(w)} to {fmtDay(w + 6)}</option>))}
                </select>
              </label>
              <button>Build scorecard</button>
            </ActionForm>
            <p className="gnote">Rebuild a week after loading late or corrected data. The Monday run never overwrites a card that exists.</p>
          </section>
        )}
        {cards.length > 0 && (
          <section className="box">
            <h2>Past scorecards</h2>
            <div className="btn-row">
              {cards.map((c) => (
                <Link key={c.weekStart} className={`chip ${c.weekStart === card?.weekStart ? "info" : ""}`} href={`/growth/${slug}/scorecard?week=${c.weekStart}`}>{c.payload.label}</Link>
              ))}
            </div>
          </section>
        )}
      </div>
    </>
  );
}
