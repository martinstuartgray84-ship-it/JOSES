import Link from "next/link";
import { db } from "@/src/server/db";
import { listActions, listBets, listDecisions } from "@/src/server/growth-office";
import { getBridge, programme, venueToday } from "@/src/server/growth-programme";
import { METRICS, VERDICTS, annualBase, attention, bridge, bridgeDefaults, fmt, heat, modelSource, moneyK, pctChange, summary, tiles } from "@/src/growth/engine";
import { EXIT_TESTS, FIRST_30_DAYS, SIX_RULES } from "@/src/growth/starter";
import { canSeeServers, growthCtx, type SP } from "../ctx";
import { Delta, Head } from "../ui";

const day = (iso: string | null) => (iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }) : "no date");

export default async function Overview({ params, searchParams }: { params: Promise<{ site: string }>; searchParams: SP }) {
  const { site: slug } = await params;
  const c = await growthCtx(slug, searchParams);
  const sql = db();
  const base = `/growth/${slug}`;
  const [p, bets, actions, decisions, saved, today] = await Promise.all([
    programme(sql, c.site.id), listBets(sql, c.site.id), listActions(sql, c.site.id), listDecisions(sql, c.site.id), getBridge(sql, c.site.id), venueToday(sql, c.site.id),
  ]);
  const m = c.model;
  const pd = c.period;
  const s = m && pd ? summary(m, pd.from, pd.to) : null;
  const plan = bridge({ ...bridgeDefaults(annualBase(s?.salesPerWeek ?? null)), ...(saved ?? {}) });
  const baseSales = plan.steps[0]!.adds;
  const h = m && pd ? heat(m, pd.from, pd.to, c.settings.seats) : null;
  const key = m && pd ? tiles(modelSource(m, c.settings.seats), pd).filter((t) => ["salesPerWeek", "sph", "dpc", "turn", "lateShare", "peakFriSat"].includes(t.key)) : [];
  const showServers = await canSeeServers(c.settings, c.site.companyId);
  const flags = m && pd && h ? attention(m, pd.from, pd.to, h).filter((f) => showServers || !f.text.startsWith("Spend per head runs")).slice(0, 4) : [];

  const activeBets = bets.filter((b) => b.status === "active");
  const betValue = activeBets.reduce((a, b) => a + (b.yearlyValue ?? 0), 0);
  const live = p.tests.filter((t) => t.status === "live");
  const toDecide = p.tests.filter((t) => t.status === "read");
  const openIdeas = p.ideas.filter((i) => i.status === "open");
  const open = actions.filter((a) => a.status === "open");
  const overdue = open.filter((a) => a.overdue);
  const next = [...overdue, ...open.filter((a) => !a.overdue).sort((a, b) => (a.due ?? "9").localeCompare(b.due ?? "9"))].slice(0, 6);
  const undecided = decisions.filter((d) => !d.decision);
  const toFind = Math.max(0, plan.targetLine - baseSales);
  const started = actions.length + bets.length + p.ideas.length + p.tests.length > 0;

  return (
    <>
      <Head title={`${c.site.name}: growth programme`}>
        Big bets on new hours, marginal gains in every hour. This is the working space for the engagement: plan it, model it, prove it here. What works becomes the platform other restaurants run.
      </Head>
      <ol className="gphases" aria-label="Where the engagement is">
        <li className="now"><strong>1. Plan and model</strong><span>Baseline the site, build the revenue model, charter the bets, pick the first tests.</span></li>
        <li><strong>2. Prove</strong><span>Run the tests and pilots. Bank what is measured and still holds at 90 days.</span></li>
        <li><strong>3. Package</strong><span>Turn what worked into the playbook and the <Link href="/suite">platform</Link>.</span></li>
        <li><strong>4. Sell</strong><span>Offer the platform and the method to other restaurants.</span></li>
      </ol>

      {(!m || !started) && (
        <section className="box gwarn">
          <h2>Get started</h2>
          <ol className="gsteps">
            <li className={m ? "done" : ""}><Link href={`${base}/data`}>Load the till and booking exports</Link> so every number below is the site&rsquo;s own.</li>
            <li className={started ? "done" : ""}><Link href={`${base}/plan`}>Load the starter pack</Link>: week-one actions, decisions, first test ideas and the big-bet charters.</li>
            <li><Link href={`${base}/settings`}>Set seats, captains and who gets the Monday scorecard</Link>.</li>
          </ol>
        </section>
      )}

      <section className="box ggoal">
        <div>
          <span className="muted">Annual net sales today</span>
          <div className="gtotal num">{baseSales ? moneyK(baseSales) : "No data"}</div>
          <span className="small muted">{s ? `${pd!.label}, annualised` : "Load till data to set the base"}</span>
        </div>
        <div className="garrow" aria-hidden="true">→</div>
        <div>
          <span className="muted">Target, {plan.targetLine && baseSales ? `${(plan.targetLine / baseSales).toFixed(1)}x` : "3x"}</span>
          <div className="gtotal num">{baseSales ? moneyK(plan.targetLine) : "No data"}</div>
          <span className="small muted">{baseSales ? `${moneyK(toFind)} a year to find` : ""}</span>
        </div>
        <div className="ggoal-bar">
          <div className="gstack" role="img" aria-label={`Of ${moneyK(toFind)} to find: ${moneyK(p.total)} banked, ${moneyK(betValue)} in big-bet charters, ${moneyK(Math.max(0, plan.gap))} not yet planned`}>
            <i className="banked" style={{ flexGrow: Math.max(p.total, 0) }} />
            <i className="planned" style={{ flexGrow: Math.max(plan.total - baseSales - p.total, 0) }} />
            <i className="gap" style={{ flexGrow: Math.max(plan.gap, 0) }} />
          </div>
          <div className="glegend small">
            <span><i className="banked" /> Banked and measured: <strong>{fmt("money0", p.total)}</strong></span>
            <span><i className="planned" /> In the plan, not yet proven: <strong>{moneyK(Math.max(plan.total - baseSales - p.total, 0))}</strong></span>
            <span><i className="gap" /> Still to find: <strong>{moneyK(Math.max(plan.gap, 0))}</strong></span>
            <Link href={`${base}/bridge`}>Open the revenue model</Link>
          </div>
        </div>
      </section>

      <div className="gcols">
        <section className="box">
          <div className="gbar"><h2>Big bets</h2><Link className="small" href={`${base}/bets`}>All bets</Link></div>
          <p className="small muted" style={{ marginTop: 0 }}>A few large moves that open hours the site does not sell today. Owned by leadership, three gates each.</p>
          {activeBets.length === 0 ? <p className="muted">No bets chartered yet.</p> : (
            <table className="tbl">
              <tbody>
                {activeBets.map((b) => (
                  <tr key={b.id}>
                    <td>{b.name}<div className="small muted">{b.lead || b.sponsor || ""}</div></td>
                    <td className="right num">{b.yearlyValue == null ? "–" : moneyK(b.yearlyValue)}</td>
                    <td className="right"><span className="ggatepips" aria-label={`${b.passed} of 3 gates passed`}>{b.gates.map((g, i) => (<i key={i} className={g.status} />))}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="gnote">{moneyK(betValue)} a year across {activeBets.length} bets; {activeBets.reduce((a, b) => a + b.passed, 0)} of {activeBets.length * 3} gates passed. Figures are placeholders until each pilot reports.</p>
        </section>
        <section className="box">
          <div className="gbar"><h2>Marginal gains</h2><Link className="small" href={`${base}/gains`}>Gains board</Link></div>
          <p className="small muted" style={{ marginTop: 0 }}>Small tested improvements to every existing hour. Owned by the whole team, three or four live at a time.</p>
          <div className="gread" style={{ marginBottom: 10 }}>
            <span>Ideas waiting<b>{openIdeas.length}</b></span>
            <span>Tests live<b>{live.length}</b></span>
            <span>Gains banked<b>{p.gains.length}</b></span>
          </div>
          {[...toDecide, ...live].slice(0, 4).map((t) => (
            <div key={t.id} className="gline">
              <Link href={`${base}/tests#t-${t.id}`}>{t.name}</Link>
              <span className="small muted"> {METRICS[t.metricKey].label.toLowerCase()} {t.read ? pctChange(t.read.primary.change) : ""}</span>{" "}
              <span className={`chip ${t.status === "read" ? "warn" : t.read ? VERDICTS[t.read.verdict].tone : ""}`}>{t.status === "read" ? "Decide: bank or stop" : t.read ? VERDICTS[t.read.verdict].label : "Live"}</span>
            </div>
          ))}
          {live.length + toDecide.length === 0 && <p className="muted" style={{ margin: 0 }}>{openIdeas.length ? "Nothing live. Pick an idea and turn it into a test." : "No ideas yet. Add the first on the gains board."}</p>}
          {p.warnings.map((w) => (<p key={w} className="gnote">{w}</p>))}
        </section>
      </div>

      {key.length > 0 && (
        <section>
          <div className="gbar"><h2>The numbers, {pd!.label}</h2><Link className="small" href={`${base}/scoreboard`}>Full scoreboard</Link></div>
          <div className="gtiles">
            {key.map((t) => (
              <div key={t.key} className="stat-tile">
                <span className="st-label">{t.label}</span>
                <span className="st-value num">{fmt(t.fmt, t.value)}</span>
                <Delta change={t.change} better={t.better} />
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="gcols">
        {flags.length > 0 && (
          <section className="box">
            <h2>Where the money is</h2>
            <ul className="gflags">{flags.map((f, i) => (<li key={i} className={f.level}>{f.text}</li>))}</ul>
          </section>
        )}
        <section className="box">
          <div className="gbar"><h2>Next actions</h2><Link className="small" href={`${base}/plan`}>The plan</Link></div>
          {next.length === 0 ? <p className="muted" style={{ margin: 0 }}>{actions.length ? "Nothing open." : "No actions yet."}</p> : (
            <ul className="gflags">
              {next.map((a) => (
                <li key={a.id} className={a.overdue ? "hot" : ""}>{a.task}<div className="small muted">{a.owner} · due {day(a.due)} {a.overdue && <span className="chip bad">Overdue</span>}</div></li>
              ))}
            </ul>
          )}
          <p className="gnote">{open.length} open, {overdue.length} overdue{undecided.length ? `, ${undecided.length} decisions still to make` : ""}.</p>
        </section>
      </div>

      <section className="box gplat">
        <div>
          <h2>The platform <span className="chip info">Prototype</span></h2>
          <p style={{ margin: 0 }}>The product this engagement is building: what a restaurant runs day to day once the method is proven. Bookings, till, kitchen and bar screens, floor coaching, guests and marketing, with this programme&rsquo;s analytics and tests on top.</p>
        </div>
        <Link className="gbtn" href="/suite">Open the platform</Link>
      </section>

      <section className="box">
        <h2>First 30 days</h2>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>When</th><th>Focus</th><th>Done when</th></tr></thead>
            <tbody>
              {FIRST_30_DAYS.map((w) => {
                const now = today >= w.from && today <= w.to;
                return (
                  <tr key={w.week} className={now ? "gnow" : ""}>
                    <td><strong>{w.week}</strong>{now && <> <span className="chip info">Now</span></>}<div className="small muted">{w.dates}</div></td>
                    <td>{w.focus}</td>
                    <td>{w.doneWhen}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <details style={{ marginTop: 10 }}>
          <summary className="small"><strong>Exit tests for day 30, and the six rules</strong></summary>
          <div className="gcols" style={{ marginTop: 8 }}>
            <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{EXIT_TESTS.map((t) => (<li key={t}>{t}</li>))}</ul>
            <ol className="small" style={{ margin: 0, paddingLeft: 18 }}>{SIX_RULES.map((t) => (<li key={t}>{t}</li>))}</ol>
          </div>
        </details>
      </section>
    </>
  );
}
