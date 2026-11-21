import Link from "next/link";
import { db } from "@/src/server/db";
import { listMeetings } from "@/src/server/growth-office";
import { listScorecards, venueToday } from "@/src/server/growth-programme";
import { fmt } from "@/src/growth/engine";
import { MEETING_KINDS, MEETING_TEMPLATES, OBJECTIONS, type MeetingKind } from "@/src/growth/starter";
import ActionForm from "../../ActionForm";
import { deleteMeetingAction, saveMeetingAction } from "../../actions";
import { growthSite, one, type SP } from "../../ctx";
import { Head } from "../../ui";

const day = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const RHYTHM: [string, string, string][] = [
  ["Every shift", "One test focus in the pre-shift brief", "2 minutes"], ["Weekly", "Gains huddle: one idea, one test started, one result", "15 minutes"],
  ["Weekly", "Trading review of the scorecard", "45 minutes"], ["Fortnightly", "Owner check-in", "30 minutes"],
  ["Monthly", "Gains review: bank, change or stop each test", "60 minutes"], ["Quarterly", "Big-bet review and bridge reforecast", "Half day"],
];

export default async function Meetings({ params, searchParams }: { params: Promise<{ site: string }>; searchParams: SP }) {
  const { site: slug } = await params;
  const site = await growthSite(slug, "/meetings");
  const sql = db();
  const [meetings, today, cards, sp] = await Promise.all([listMeetings(sql, site.id), venueToday(sql, site.id), listScorecards(sql, site.id, 1), searchParams]);
  const kind = (one(sp.new) && one(sp.new)! in MEETING_KINDS ? one(sp.new) : null) as MeetingKind | null;
  const card = cards[0]?.payload;
  // The weekly review opens on the latest scorecard, so the notes start from the numbers.
  const scoreLines = card ? [`SCORECARD, ${card.label}`, ...card.tiles.map((t) => `${t.label}: ${fmt(t.fmt, t.value)} (week before ${fmt(t.fmt, t.priorWeek)}, four-week average ${fmt(t.fmt, t.fourWeek)})`), "", ""].join("\n") : "";
  const base = `/growth/${slug}/meetings`;
  return (
    <>
      <Head title="Meetings">One record per meeting: who was there, what was said, what was agreed. Put actions and decisions on the Plan as well, so they are tracked.</Head>
      <section className="box">
        <h2>Start the notes for a meeting</h2>
        <div className="btn-row">
          {(Object.keys(MEETING_KINDS) as MeetingKind[]).map((k) => (
            <Link key={k} className={`gbtn small ${kind === k ? "primary" : ""}`} href={`${base}?new=${k}#new`} scroll={false}>{MEETING_KINDS[k].label}</Link>
          ))}
        </div>
        {kind && (
          <div id="new" style={{ marginTop: 14 }}>
            <ActionForm action={saveMeetingAction.bind(null, slug)} className="gform" key={kind}>
              <input type="hidden" name="kind" value={kind} />
              <label>Title<input name="title" defaultValue={MEETING_KINDS[kind].label} maxLength={160} /></label>
              <label>Date<input name="heldOn" type="date" required defaultValue={today} /></label>
              <label className="wide">Who was there<input name="attendees" maxLength={500} placeholder="Roles or first names" autoComplete="off" /></label>
              <label className="wide">Notes<textarea name="notes" className="gnotes" defaultValue={(kind === "weekly_review" ? scoreLines : "") + MEETING_TEMPLATES[kind]} maxLength={20000} /></label>
              <button className="primary">Save meeting</button>
            </ActionForm>
            {MEETING_KINDS[kind].length && <p className="gnote">{MEETING_KINDS[kind].length}.{kind === "weekly_review" && !card ? " Build a scorecard first and the notes will open on its numbers." : ""}</p>}
            {kind === "mobilisation" && (
              <details style={{ marginTop: 10 }}>
                <summary className="small"><strong>If they say</strong></summary>
                <dl className="gsay">
                  {OBJECTIONS.map(([q, a]) => (<div key={q}><dt>&ldquo;{q}&rdquo;</dt><dd>{a}</dd></div>))}
                </dl>
                <p className="gnote">Start with their observations before showing any plan.</p>
              </details>
            )}
          </div>
        )}
      </section>
      {meetings.map((m) => (
        <section key={m.id} className="box">
          <div className="gbar"><h2>{m.title}</h2><span className="muted small">{day(m.heldOn)} · {MEETING_KINDS[m.kind].label}</span></div>
          {m.attendees && <p className="small muted" style={{ margin: "0 0 8px" }}>Present: {m.attendees}</p>}
          <details>
            <summary className="small">Read or edit the notes</summary>
            <ActionForm action={saveMeetingAction.bind(null, slug)} className="gform" keep>
              <input type="hidden" name="id" value={m.id} />
              <input type="hidden" name="kind" value={m.kind} />
              <label>Title<input name="title" defaultValue={m.title} maxLength={160} /></label>
              <label>Date<input name="heldOn" type="date" required defaultValue={m.heldOn} /></label>
              <label className="wide">Who was there<input name="attendees" defaultValue={m.attendees ?? ""} maxLength={500} /></label>
              <label className="wide">Notes<textarea name="notes" className="gnotes" defaultValue={m.notes} maxLength={20000} /></label>
              <button className="primary">Save</button>
            </ActionForm>
            <ActionForm action={deleteMeetingAction.bind(null, slug, m.id)} confirm="Remove this meeting and its notes?"><button className="small ghost danger-outline" style={{ marginTop: 8 }}>Remove meeting</button></ActionForm>
          </details>
        </section>
      ))}
      <section className="box">
        <h2>The rhythm</h2>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>When</th><th>What</th><th>Length</th></tr></thead>
            <tbody>{RHYTHM.map(([w, what, len]) => (<tr key={what}><td>{w}</td><td>{what}</td><td>{len}</td></tr>))}</tbody>
          </table>
        </div>
      </section>
    </>
  );
}
