import Link from "next/link";
import { db } from "@/src/server/db";
import { getSettings } from "@/src/server/growth";
import { programme } from "@/src/server/growth-programme";
import { METRICS, VERDICTS, fmt, pctChange, type MetricKey } from "@/src/growth/engine";
import ActionForm from "../../ActionForm";
import { addIdeaAction, ideaStatusAction, recheckGainAction } from "../../actions";
import { growthSite } from "../../ctx";
import { Head } from "../../ui";

const day = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const metric = (k: string) => METRICS[k as MetricKey]?.label ?? k;

export default async function GainsBoard({ params }: { params: Promise<{ site: string }> }) {
  const { site: slug } = await params;
  const site = await growthSite(slug, "/gains");
  const [p, settings] = await Promise.all([programme(db(), site.id), getSettings(db(), site.id)]);
  const open = p.ideas.filter((i) => i.status === "open");
  const running = p.tests.filter((t) => ["planned", "live", "read"].includes(t.status));
  const due = p.gains.filter((g) => g.recheckDue).length;
  return (
    <>
      <Head title="Gains board">Anyone can propose, everyone hears the result. An idea names the one number it should move; a gain counts once it is banked and still holds after 90 days.</Head>
      <div className="gcols">
        <section className="box">
          <span className="muted">Banked so far, a year</span>
          <div className="gtotal num">{fmt("money0", p.total)}</div>
          <span className="muted small">
            {p.gains.length} {p.gains.length === 1 ? "gain" : "gains"} banked, {running.filter((t) => t.status === "live").length} tests live, {open.length} ideas waiting{due ? `, ${due} due a 90-day re-check` : ""}.
          </span>
        </section>
        <section className="box">
          <h2>Add an idea</h2>
          <ActionForm action={addIdeaAction.bind(null, slug)} className="gquick">
            <label>
              What would change?
              <textarea name="change" required maxLength={500} placeholder="Offer a named drink within two minutes of seating" />
            </label>
            <label>
              Which number should it move?
              <select name="metricKey" defaultValue="sph">
                {Object.entries(METRICS).map(([k, v]) => (
                  <option key={k} value={k}>{v.label}</option>
                ))}
              </select>
            </label>
            <details className="gadd">
              <summary className="muted small">Add more: how to test it, the risk to the guest, who and where</summary>
              <div className="gquick">
                <label>How would we test it?<input name="howToTest" maxLength={500} placeholder="Half the sections, swapping weekly, three weeks" /></label>
                <label>What could go wrong for the guest?<input name="guestRisk" maxLength={500} placeholder="Feels pushy at quiet tables" /></label>
                <div className="row">
                  <label>Your name<input name="proposerName" maxLength={60} autoComplete="off" /></label>
                  <label>
                    Gain area
                    <select name="gainArea" defaultValue={settings.gainAreas[1]?.name ?? settings.gainAreas[0]?.name}>
                      {settings.gainAreas.map((a) => (
                        <option key={a.name}>{a.name}</option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>
            </details>
            <button className="primary">Add idea</button>
          </ActionForm>
        </section>
      </div>
      {p.warnings.map((w) => (
        <p key={w} className="box gwarn" style={{ margin: 0 }}>{w}</p>
      ))}
      <div className="gboard">
        <div className="gcol">
          <h2>Ideas <span className="chip">{open.length}</span></h2>
          {open.length === 0 && <p className="muted">No ideas waiting. Add the first one above.</p>}
          {open.map((i) => (
            <article key={i.id} className="gcard">
              <h3>{i.change}</h3>
              <dl>
                <dt>Moves</dt><dd>{metric(i.metricKey)}</dd>
                {i.howToTest && (<><dt>Test</dt><dd>{i.howToTest}</dd></>)}
                {i.guestRisk && (<><dt>Guest risk</dt><dd>{i.guestRisk}</dd></>)}
              </dl>
              <span className="small muted">{i.gainArea}{i.proposerName ? ` · ${i.proposerName}` : ""} · {i.createdAt.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: site.timezone })}</span>
              <div className="btn-row">
                <Link className="gbtn small" href={`/growth/${slug}/tests?idea=${i.id}#new`}>Turn into a test</Link>
                <ActionForm className="ginline" action={ideaStatusAction.bind(null, slug, i.id, "declined")}>
                  <button className="small ghost">Not now</button>
                </ActionForm>
              </div>
            </article>
          ))}
        </div>
        <div className="gcol">
          <h2>Tests <span className="chip">{running.length}</span></h2>
          {running.length === 0 && <p className="muted">Nothing being tested. Turn an idea into a test.</p>}
          {running.map((t) => (
            <article key={t.id} className="gcard">
              <h3>{t.name}</h3>
              <span className="small muted">{t.gainArea} · {metric(t.metricKey)} · {t.status === "planned" ? "starts" : "started"} {day(t.startDay)}{t.ownerName ? ` · ${t.ownerName}` : ""}</span>
              {t.read && t.status !== "planned" && (
                <div className="gread">
                  <span>{t.read.controlLabel}<b>{fmt(METRICS[t.metricKey].fmt, t.read.primary.control)}</b></span>
                  <span>{t.read.testLabel}<b>{fmt(METRICS[t.metricKey].fmt, t.read.primary.test)}</b></span>
                  <span>Change<b>{pctChange(t.read.primary.change)}</b></span>
                </div>
              )}
              <div className="btn-row">
                <span className={`chip ${t.status === "live" ? "info" : t.status === "read" ? "warn" : ""}`}>{t.status === "read" ? "Read: decide" : t.status === "live" ? "Live" : "Planned"}</span>
                {t.read && t.status !== "planned" && <span className={`chip ${VERDICTS[t.read.verdict].tone}`}>{VERDICTS[t.read.verdict].label}</span>}
                {t.read?.guardrailBreached && <span className="chip bad">Guardrail moved</span>}
              </div>
              <Link className="small" href={`/growth/${slug}/tests#t-${t.id}`}>Open test</Link>
            </article>
          ))}
        </div>
        <div className="gcol">
          <h2>Banked gains <span className="chip">{p.gains.length}</span></h2>
          {p.gains.length === 0 && <p className="muted">No gains banked yet. A test that passes and is written into how you work lands here.</p>}
          {p.gains.map((g) => (
            <article key={g.id} className="gcard">
              <h3>{g.name}</h3>
              <span className="small muted">{g.gainArea} · banked {day(g.bankedOn)}</span>
              <div className="gread">
                <span>{metric(g.metricKey)}<b>{pctChange(g.changePct / 100)}</b></span>
                <span>Worth a year<b>{g.yearlyValue == null ? "Not valued" : fmt("money0", g.yearlyValue)}</b></span>
              </div>
              {g.stillHolding === true && <span className="chip good" style={{ justifySelf: "start" }}>Still holding at 90 days</span>}
              {g.stillHolding === false && <span className="chip bad" style={{ justifySelf: "start" }}>Slipped back: no longer counted</span>}
              {g.stillHolding === null && !g.recheckDue && <span className="small muted">Re-check on {day(g.recheckDay)}</span>}
              {g.recheckDue && (
                <div className="btn-row">
                  <span className="chip warn">90-day re-check due</span>
                  <ActionForm className="ginline" action={recheckGainAction.bind(null, slug, g.id, true)}><button className="small">Still holding</button></ActionForm>
                  <ActionForm className="ginline" action={recheckGainAction.bind(null, slug, g.id, false)}><button className="small ghost">Slipped back</button></ActionForm>
                </div>
              )}
            </article>
          ))}
        </div>
      </div>
      {p.ideas.some((i) => i.status === "declined") && (
        <details className="box">
          <summary className="muted">Ideas set aside ({p.ideas.filter((i) => i.status === "declined").length})</summary>
          {p.ideas.filter((i) => i.status === "declined").map((i) => (
            <div key={i.id} className="btn-row" style={{ marginTop: 8, alignItems: "center" }}>
              <span>{i.change}</span>
              <ActionForm className="ginline" action={ideaStatusAction.bind(null, slug, i.id, "open")}><button className="small ghost">Bring back</button></ActionForm>
            </div>
          ))}
        </details>
      )}
    </>
  );
}
