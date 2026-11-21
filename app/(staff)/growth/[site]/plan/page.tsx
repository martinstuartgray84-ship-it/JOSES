import { db } from "@/src/server/db";
import { listActions, listDecisions, type Action } from "@/src/server/growth-office";
import ActionForm from "../../ActionForm";
import { actionStatusAction, addActionAction, editActionAction, loadStarterAction, saveDecisionAction } from "../../actions";
import { growthSite } from "../../ctx";
import { Head, Stat } from "../../ui";

const day = (iso: string | null) => (iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }) : "No date");

export default async function Plan({ params }: { params: Promise<{ site: string }> }) {
  const { site: slug } = await params;
  const site = await growthSite(slug, "/plan");
  const [actions, decisions] = await Promise.all([listActions(db(), site.id), listDecisions(db(), site.id)]);
  const open = actions.filter((a) => a.status === "open");
  const owners = [...new Set(actions.map((a) => a.owner))];
  const byOwner = new Map<string, Action[]>(owners.map((o) => [o, actions.filter((a) => a.owner === o)]));
  const undecided = decisions.filter((d) => !d.decision).length;
  return (
    <>
      <Head title="Plan">Who is doing what by when, and what has been agreed. When something is agreed, done or learned, record it here the same day.</Head>
      {actions.length === 0 && decisions.length === 0 && (
        <section className="box gwarn">
          <p style={{ margin: "0 0 10px" }}><strong>Start from the programme pack.</strong> It adds the week-one action list for each role, the decisions to make at the mobilisation meeting, seven first test ideas and the big-bet charters. Dates and figures are the pack&rsquo;s placeholders: change them to suit.</p>
          <ActionForm action={loadStarterAction.bind(null, slug)} keep><button className="primary">Load the starter pack</button></ActionForm>
        </section>
      )}
      <div className="gtiles">
        <Stat label="Actions open" value={String(open.length)} hint={`${actions.filter((a) => a.status === "done").length} done`} />
        <Stat label="Overdue" value={String(open.filter((a) => a.overdue).length)} />
        <Stat label="Decisions still to make" value={String(undecided)} hint={`${decisions.length - undecided} made`} />
      </div>
      <section className="box">
        <h2>Add an action</h2>
        <ActionForm action={addActionAction.bind(null, slug)} className="gform">
          <label className="wide">What needs doing<input name="task" required maxLength={300} /></label>
          <label>Owner<input name="owner" required maxLength={60} list="owners" autoComplete="off" /></label>
          <label>Due<input name="due" type="date" /></label>
          <button className="primary">Add action</button>
        </ActionForm>
        <datalist id="owners">{owners.map((o) => (<option key={o} value={o} />))}</datalist>
      </section>
      {owners.map((owner) => {
        const list = byOwner.get(owner)!;
        const left = list.filter((a) => a.status === "open").length;
        return (
          <section key={owner} className="box">
            <div className="gbar"><h2>{owner}</h2><span className={`chip ${left ? "" : "good"}`}>{left ? `${left} open` : "All done"}</span></div>
            <ul className="gacts">
              {list.map((a) => (
                <li key={a.id} className={a.status}>
                  <ActionForm className="ginline" action={actionStatusAction.bind(null, slug, a.id, a.status === "open" ? "done" : "open")}>
                    <button className="gtick" aria-label={a.status === "open" ? `Mark done: ${a.task}` : `Reopen: ${a.task}`} aria-pressed={a.status === "done"}>{a.status === "done" ? "✓" : ""}</button>
                  </ActionForm>
                  <div>
                    <span className="gtask">{a.task}</span>
                    <div className="small muted">
                      {a.ref ? `${a.ref} · ` : ""}{a.status === "done" ? `done ${day(a.doneOn)}` : a.status === "dropped" ? "dropped" : `due ${day(a.due)}`} {a.overdue && <span className="chip bad">Overdue</span>}
                      {a.notes ? ` · ${a.notes}` : ""}
                    </div>
                    <details>
                      <summary className="small muted">Change</summary>
                      <ActionForm action={editActionAction.bind(null, slug, a.id)} className="gform" keep>
                        <label>Owner<input name="owner" required defaultValue={a.owner} maxLength={60} list="owners" /></label>
                        <label>Due<input name="due" type="date" defaultValue={a.due ?? ""} /></label>
                        <label className="wide">Note<input name="notes" defaultValue={a.notes ?? ""} maxLength={500} /></label>
                        <button>Save</button>
                      </ActionForm>
                      {a.status !== "dropped" && (
                        <ActionForm className="ginline" action={actionStatusAction.bind(null, slug, a.id, "dropped")}><button className="small ghost" style={{ marginTop: 8 }}>Drop this action</button></ActionForm>
                      )}
                    </details>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      <section className="box">
        <h2>Decisions</h2>
        {decisions.length === 0 && <p className="muted" style={{ marginTop: 0 }}>Nothing recorded yet.</p>}
        {decisions.map((d) => (
          <details key={d.id} className="gdec" open={false}>
            <summary>
              <strong>{d.item}</strong>
              {d.decision ? <span> {d.decision} <span className="small muted">({d.decidedBy ? `${d.decidedBy}, ` : ""}{day(d.decidedOn)})</span></span> : <span className="chip warn">To decide</span>}
            </summary>
            <ActionForm action={saveDecisionAction.bind(null, slug)} className="gform" keep>
              <input type="hidden" name="id" value={d.id} />
              <label className="wide">Decision<input name="decision" defaultValue={d.decision ?? ""} maxLength={500} /></label>
              <label>Decided by<input name="decidedBy" defaultValue={d.decidedBy ?? ""} maxLength={60} autoComplete="off" /></label>
              <label>Note<input name="notes" defaultValue={d.notes ?? ""} maxLength={500} /></label>
              <button>Save</button>
            </ActionForm>
          </details>
        ))}
        <details className="gadd" style={{ marginTop: 12 }}>
          <summary><span className="gbtn small">Record another decision</span></summary>
          <ActionForm action={saveDecisionAction.bind(null, slug)} className="gform">
            <label>What was decided on<input name="item" required maxLength={200} /></label>
            <label className="wide">Decision<input name="decision" maxLength={500} /></label>
            <label>Decided by<input name="decidedBy" maxLength={60} autoComplete="off" /></label>
            <button className="primary">Save decision</button>
          </ActionForm>
        </details>
      </section>
    </>
  );
}
