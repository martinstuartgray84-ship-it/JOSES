import { db } from "@/src/server/db";
import { getSettings } from "@/src/server/growth";
import { programme, venueToday } from "@/src/server/growth-programme";
import { DESIGNS, METRICS, VERDICTS, fmt, pctChange, type MetricKey, type Read } from "@/src/growth/engine";
import ActionForm from "../../ActionForm";
import { createTestAction, decideTestAction, readTestAction, startTestAction } from "../../actions";
import { growthSite, one, type SP } from "../../ctx";
import { Head } from "../../ui";

const day = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const STATUS: Record<string, { label: string; tone: string }> = {
  planned: { label: "Planned", tone: "" }, live: { label: "Live", tone: "info" }, read: { label: "Read: decide", tone: "warn" },
  banked: { label: "Banked", tone: "good" }, stopped: { label: "Stopped", tone: "" },
};

function ReadRow({ title, r, control, test }: { title: string; r: Read; control: string; test: string }) {
  const m = METRICS[r.key];
  return (
    <tr>
      <td>{title}<div className="small muted">{m.label}</div></td>
      <td className="right num">{fmt(m.fmt, r.control)}<div className="small muted">{control}</div></td>
      <td className="right num">{fmt(m.fmt, r.test)}<div className="small muted">{test}</div></td>
      <td className="right num"><strong>{pctChange(r.change)}</strong></td>
    </tr>
  );
}

export default async function Tests({ params, searchParams }: { params: Promise<{ site: string }>; searchParams: SP }) {
  const { site: slug } = await params;
  const site = await growthSite(slug, "/tests");
  const sql = db();
  const [p, settings, today, sp] = await Promise.all([programme(sql, site.id), getSettings(sql, site.id), venueToday(sql, site.id), searchParams]);
  const idea = p.ideas.find((i) => i.id === one(sp.idea) && i.status === "open");
  return (
    <>
      <Head title="Tests">One change at a time. Each test has one primary metric, a guest guardrail, a design, dates, a pass mark and an owner.</Head>
      {!p.hasData && <p className="box gwarn" style={{ margin: 0 }}>No till data is loaded, so tests cannot be read yet. You can still plan them.</p>}
      {p.warnings.map((w) => (
        <p key={w} className="box gwarn" style={{ margin: 0 }}>{w}</p>
      ))}
      {p.tests.length === 0 && <p className="muted">No tests yet. Set up the first one below.</p>}
      {p.tests.map((t) => (
        <section key={t.id} id={`t-${t.id}`} className="box">
          <div className="gbar">
            <h2>{t.name}</h2>
            <div className="btn-row">
              <span className={`chip ${STATUS[t.status]!.tone}`}>{STATUS[t.status]!.label}</span>
              {t.read && t.status !== "planned" && <span className={`chip ${VERDICTS[t.read.verdict].tone}`}>{VERDICTS[t.read.verdict].label}</span>}
            </div>
          </div>
          <p className="muted small" style={{ margin: "0 0 10px" }}>
            {t.gainArea} · {DESIGNS[t.design].label}{t.design === "split_section" ? ` (tables ${t.testTables.join(", ")})` : ""} · {day(t.startDay)} to {t.endDay ? day(t.endDay) : "open"} · pass mark {t.passMarkPct > 0 ? "+" : ""}{t.passMarkPct}%{t.ownerName ? ` · owner ${t.ownerName}` : ""}
          </p>
          {t.read && t.status !== "planned" ? (
            <>
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead><tr><th /><th className="right">Compared with</th><th className="right">Test</th><th className="right">Change</th></tr></thead>
                  <tbody>
                    <ReadRow title="Primary" r={t.read.primary} control={t.read.controlLabel} test={t.read.testLabel} />
                    {t.read.guardrail && <ReadRow title="Guardrail" r={t.read.guardrail} control={t.read.controlLabel} test={t.read.testLabel} />}
                  </tbody>
                </table>
              </div>
              <p className="gnote">
                {t.read.weeks.toFixed(t.read.weeks % 1 ? 1 : 0)} weeks of test data{t.status === "live" ? ", as it stands now" : ", as read"}.{" "}
                {t.read.guardrailBreached ? <strong className="bad-text">The guardrail moved the wrong way by more than 2%. </strong> : t.read.guardrail?.change != null ? "The guardrail held. " : ""}
                {t.design === "before_after" && "A before-and-after comparison cannot separate the change from season or weather."}
              </p>
            </>
          ) : (
            t.status === "planned" && <p className="gnote">Not started. The readout appears once the test is live and data from its start date is loaded.</p>
          )}
          {t.notes && <p className="small" style={{ margin: "8px 0 0" }}>{t.notes}</p>}
          {t.decidedBy && <p className="small muted" style={{ margin: "8px 0 0" }}>{t.status === "banked" ? "Banked" : "Stopped"} by {t.decidedBy} on {t.decidedAt?.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: site.timezone })}.</p>}

          {t.status === "planned" && (
            <div className="btn-row" style={{ marginTop: 12 }}>
              <ActionForm className="ginline" action={startTestAction.bind(null, slug, t.id)}><button className="primary">Make it live</button></ActionForm>
            </div>
          )}
          {t.status === "live" && (
            <div className="btn-row" style={{ marginTop: 12 }}>
              <ActionForm className="ginline" action={readTestAction.bind(null, slug, t.id)}><button className="primary">Read the result</button></ActionForm>
            </div>
          )}
          {t.status === "read" && (
            <ActionForm action={decideTestAction.bind(null, slug, t.id, "bank")} className="gform" keep>
              <label>Decided by<input name="decidedBy" required maxLength={60} autoComplete="off" /></label>
              <label>
                Worth a year, £
                <input name="yearlyValue" inputMode="decimal" defaultValue={t.suggestedValue != null && t.suggestedValue > 0 ? Math.round(t.suggestedValue / 100) * 100 : ""} />
              </label>
              <label className="wide">Note for the record<input name="notes" maxLength={2000} placeholder="Written into the service steps from Monday" /></label>
              <button className="primary">Bank the gain</button>
              <p className="gnote wide">{t.suggestedValue != null ? "The yearly figure is a first estimate from the measured change and the last 12 weeks' volumes. Overwrite it if you know better." : "There is no simple conversion to pounds for this metric. Enter your own estimate, or leave it blank."}</p>
            </ActionForm>
          )}
          {["planned", "live", "read"].includes(t.status) && (
            <details style={{ marginTop: 12 }}>
              <summary className="muted small">Stop this test without banking</summary>
              <ActionForm action={decideTestAction.bind(null, slug, t.id, "stop")} className="gform" keep>
                <label>Decided by<input name="decidedBy" required maxLength={60} autoComplete="off" /></label>
                <label>Why<input name="notes" maxLength={2000} placeholder="No movement after three weeks" /></label>
                <button>Stop the test</button>
              </ActionForm>
            </details>
          )}
        </section>
      ))}

      <section className="box" id="new">
        <h2>{idea ? "Turn the idea into a test" : "Set up a test"}</h2>
        {idea && <p className="summary" style={{ marginBottom: 12 }}>{idea.change}{idea.howToTest ? ` How: ${idea.howToTest}` : ""}{idea.guestRisk ? ` Guest risk: ${idea.guestRisk}` : ""}</p>}
        <ActionForm action={createTestAction.bind(null, slug)} className="gform" key={idea?.id ?? "blank"}>
          {idea && <input type="hidden" name="ideaId" value={idea.id} />}
          <label className="wide">Name<input name="name" required maxLength={120} defaultValue={idea?.change.slice(0, 120) ?? ""} placeholder="First drink in two minutes" /></label>
          <label>
            Gain area
            <select name="gainArea" defaultValue={idea?.gainArea ?? settings.gainAreas[0]?.name}>
              {settings.gainAreas.map((a) => (<option key={a.name}>{a.name}</option>))}
            </select>
          </label>
          <label>
            Primary metric
            <select name="metricKey" defaultValue={(idea?.metricKey as MetricKey) ?? "sph"}>
              {Object.entries(METRICS).map(([k, v]) => (<option key={k} value={k}>{v.label}</option>))}
            </select>
          </label>
          <label>
            Guest guardrail
            <select name="guardrailKey" defaultValue="turn">
              <option value="">None</option>
              {Object.entries(METRICS).map(([k, v]) => (<option key={k} value={k}>{v.label}</option>))}
            </select>
          </label>
          <label>
            Design
            <select name="design" defaultValue="alternate_weeks">
              {Object.entries(DESIGNS).map(([k, v]) => (<option key={k} value={k}>{v.label}</option>))}
            </select>
          </label>
          <label>Start date<input name="startDay" type="date" required defaultValue={today} /></label>
          <label>End date<input name="endDay" type="date" /></label>
          <label>Pass mark, %<input name="passMarkPct" type="number" step="0.5" required defaultValue={5} /></label>
          <label>Owner<input name="ownerName" maxLength={60} autoComplete="off" /></label>
          <label className="wide">Tables in the test section, for a split by section<input name="testTables" placeholder="T1, T2, T3, T4" /></label>
          <label className="check wide"><input type="checkbox" name="live" value="1" /> Make it live straight away</label>
          <button className="primary">Save test</button>
        </ActionForm>
        <ul className="gnote" style={{ paddingLeft: 18 }}>
          {Object.values(DESIGNS).map((d) => (<li key={d.label}><strong>{d.label}.</strong> {d.help}</li>))}
          <li>For a metric where lower is better, such as turn time or no-shows, set a negative pass mark, such as -5.</li>
        </ul>
      </section>
    </>
  );
}
