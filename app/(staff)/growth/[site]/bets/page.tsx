import { db } from "@/src/server/db";
import { listBets, type Bet } from "@/src/server/growth-office";
import { fmt, moneyK } from "@/src/growth/engine";
import ActionForm from "../../ActionForm";
import { saveBetAction } from "../../actions";
import { growthSite } from "../../ctx";
import { Head, Stat } from "../../ui";

const day = (iso?: string | null) => (iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "");
const TONE = { pending: "", passed: "good", failed: "bad" } as const;
const BLANK: Bet = { id: "", name: "", yearlyValue: null, sponsor: "", lead: "", measures: "", stopRule: "", notes: "", status: "active", passed: 0, gates: [0, 1, 2].map(() => ({ title: "", test: "", status: "pending" as const })) };

function BetForm({ slug, b }: { slug: string; b: Bet }) {
  return (
    <ActionForm action={saveBetAction.bind(null, slug)} className="gform" keep={!!b.id}>
      {b.id && <input type="hidden" name="id" value={b.id} />}
      <label>Name<input name="name" required defaultValue={b.name} maxLength={120} /></label>
      <label>Worth a year, £<input name="yearlyValue" inputMode="decimal" defaultValue={b.yearlyValue ?? ""} /></label>
      <label>Sponsor<input name="sponsor" defaultValue={b.sponsor ?? ""} maxLength={80} /></label>
      <label>Lead<input name="lead" defaultValue={b.lead ?? ""} maxLength={80} /></label>
      <label>
        Status
        <select name="status" defaultValue={b.status}><option value="active">Active</option><option value="parked">Not yet chartered</option><option value="stopped">Stopped</option></select>
      </label>
      {[0, 1, 2].map((i) => (
        <div key={i} className="wide ggate">
          <label>Gate {i + 1}: what must be true<textarea name={`gate_test_${i}`} defaultValue={b.gates[i]?.test ?? ""} maxLength={600} /></label>
          <label>
            Result
            <select name={`gate_status_${i}`} defaultValue={b.gates[i]?.status ?? "pending"}><option value="pending">Not yet decided</option><option value="passed">Passed</option><option value="failed">Failed</option></select>
          </label>
          <label>Decided on<input type="date" name={`gate_on_${i}`} defaultValue={b.gates[i]?.decided_on ?? ""} /></label>
        </div>
      ))}
      <label className="wide">Measures<input name="measures" defaultValue={b.measures ?? ""} maxLength={600} /></label>
      <label className="wide">Stop rule<input name="stopRule" defaultValue={b.stopRule ?? ""} maxLength={600} /></label>
      <label className="wide">Notes<textarea name="notes" defaultValue={b.notes ?? ""} maxLength={2000} /></label>
      <button className="primary">{b.id ? "Save bet" : "Add bet"}</button>
    </ActionForm>
  );
}

export default async function Bets({ params }: { params: Promise<{ site: string }> }) {
  const { site: slug } = await params;
  const site = await growthSite(slug, "/bets");
  const bets = await listBets(db(), site.id);
  const active = bets.filter((b) => b.status === "active");
  const sum = (list: Bet[]) => list.reduce((a, b) => a + (b.yearlyValue ?? 0), 0);
  return (
    <>
      <Head title="Big bets">A few large moves that open up time the venue does not sell today. Each passes three gates: allowed and feasible, a pilot made money, still makes money at scale. Reviewed quarterly.</Head>
      {bets.length === 0 ? (
        <p className="box" style={{ margin: 0 }}>No bets chartered yet. Load the starter pack from Plan, or add one below.</p>
      ) : (
        <div className="gtiles">
          <Stat label="Active bets" value={String(active.length)} hint={`${bets.filter((b) => b.status === "parked").length} not yet chartered`} />
          <Stat label="In the plan, a year" value={moneyK(sum(active))} hint="Placeholder until each pilot reports" />
          <Stat label="Proven at scale (gate 3)" value={moneyK(sum(active.filter((b) => b.passed === 3)))} />
          <Stat label="Gates passed" value={`${active.reduce((a, b) => a + b.passed, 0)} of ${active.length * 3}`} />
        </div>
      )}
      {bets.map((b) => (
        <section key={b.id} className="box">
          <div className="gbar">
            <h2>{b.name}{b.yearlyValue != null && <span className="muted"> · {fmt("money0", b.yearlyValue)} a year</span>}</h2>
            <span className={`chip ${b.status === "active" ? "info" : ""}`}>{b.status === "active" ? `Gate ${Math.min(b.passed + 1, 3)} of 3${b.passed === 3 ? ": all passed" : ""}` : b.status === "parked" ? "Not yet chartered" : "Stopped"}</span>
          </div>
          {(b.sponsor || b.lead) && <p className="small muted" style={{ margin: "0 0 10px" }}>{b.sponsor ? `Sponsor: ${b.sponsor}. ` : ""}{b.lead ? `Lead: ${b.lead}.` : ""}</p>}
          {b.status !== "parked" && (
            <ol className="ggates">
              {b.gates.map((g, i) => (
                <li key={i} className={g.status}>
                  <strong>{g.title || `Gate ${i + 1}`}</strong> <span className={`chip ${TONE[g.status]}`}>{g.status === "pending" ? "Not yet decided" : `${g.status === "passed" ? "Passed" : "Failed"} ${day(g.decided_on)}`}</span>
                  <div className="small">{g.test}</div>
                </li>
              ))}
            </ol>
          )}
          {b.measures && <p className="small" style={{ margin: "8px 0 0" }}><strong>Measures:</strong> {b.measures}</p>}
          {b.stopRule && <p className="small" style={{ margin: "4px 0 0" }}><strong>Stop rule:</strong> {b.stopRule}</p>}
          {b.notes && <p className="small" style={{ margin: "4px 0 0", whiteSpace: "pre-wrap" }}>{b.notes}</p>}
          <details style={{ marginTop: 10 }}>
            <summary className="small muted">Update this bet</summary>
            <BetForm slug={slug} b={b} />
          </details>
        </section>
      ))}
      <section className="box">
        <details className="gadd">
          <summary><span className="gbtn small">Charter another bet</span></summary>
          <BetForm slug={slug} b={BLANK} />
        </details>
      </section>
    </>
  );
}
