import { db } from "@/src/server/db";
import { turnawayTally } from "@/src/server/growth-office";
import { fmt, hourLabel, summary } from "@/src/growth/engine";
import { TURNAWAY_REASONS } from "@/src/growth/starter";
import ActionForm from "../../ActionForm";
import { deleteTurnawayAction, logTurnawayAction } from "../../actions";
import { growthCtx, type SP } from "../../ctx";
import { Head, Stat } from "../../ui";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const when = (s: string) => new Date(`${s}:00Z`).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });

export default async function Turnaways({ params, searchParams }: { params: Promise<{ site: string }>; searchParams: SP }) {
  const { site: slug } = await params;
  const c = await growthCtx(slug, searchParams, "/turnaways");
  const sql = db();
  const [t, [clock]] = await Promise.all([turnawayTally(sql, c.site.id), sql`select to_char(now() at time zone ${c.site.timezone}, 'YYYY-MM-DD"T"HH24:MI') as now`]);
  const sph = c.model && c.period ? summary(c.model, c.period.from, c.period.to).sph : null;
  return (
    <>
      <Head title="Turn-aways">Every guest the door or the phone could not seat. This is demand the till never sees: it shows where another sitting, a bar handover or a later close would pay.</Head>
      <section className="box">
        <h2>Log a turn-away</h2>
        <ActionForm action={logTurnawayAction.bind(null, slug)} className="gform">
          <label>Guests<input name="partySize" type="number" min={1} max={500} required defaultValue={2} inputMode="numeric" /></label>
          <label>
            Why
            <select name="reason">{TURNAWAY_REASONS.map((r) => (<option key={r}>{r}</option>))}</select>
          </label>
          <label>When<input name="turnedAt" type="datetime-local" required defaultValue={clock!.now} /></label>
          <label>What we offered instead<input name="offeredAlternative" maxLength={200} placeholder="9:15 table, bar seats, another night" /></label>
          <button className="primary">Log it</button>
        </ActionForm>
      </section>
      <div className="gtiles">
        <Stat label="Parties turned away, last 28 days" value={fmt("int", t.parties)} />
        <Stat label="Guests turned away" value={fmt("int", t.guests)} />
        <Stat label="Sales that walked, estimate" value={sph == null ? "No data" : fmt("money0", t.guests * sph)} hint={sph == null ? "Needs till data for spend per head" : `Guests × ${fmt("money2", sph)} spend per head`} />
      </div>
      {t.parties > 0 && (
        <div className="gcols">
          <section className="box">
            <h2>Why, last 28 days</h2>
            <table className="tbl">
              <thead><tr><th>Reason</th><th className="right">Parties</th><th className="right">Guests</th></tr></thead>
              <tbody>{t.byReason.map((r) => (<tr key={r.reason}><td>{r.reason}</td><td className="right num">{r.parties}</td><td className="right num">{r.guests}</td></tr>))}</tbody>
            </table>
          </section>
          <section className="box">
            <h2>When it happens most</h2>
            <table className="tbl">
              <thead><tr><th>Day and hour</th><th className="right">Guests</th></tr></thead>
              <tbody>{t.bySlot.map((s) => (<tr key={`${s.dow}-${s.hour}`}><td>{DAYS[s.dow]}, {hourLabel(s.hour)}</td><td className="right num">{s.guests}</td></tr>))}</tbody>
            </table>
            <p className="gnote">After midnight counts towards the night before.</p>
          </section>
        </div>
      )}
      <section className="box">
        <h2>The log</h2>
        {t.recent.length === 0 ? <p className="muted" style={{ margin: 0 }}>Nothing logged yet. Brief the hosts to log every one, including phone calls.</p> : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>When</th><th className="right">Guests</th><th>Why</th><th>Offered instead</th><th /></tr></thead>
              <tbody>
                {t.recent.map((r) => (
                  <tr key={r.id}>
                    <td>{when(r.turnedAt)}</td><td className="right num">{r.partySize}</td><td>{r.reason}</td><td>{r.offeredAlternative ?? "–"}</td>
                    <td><ActionForm className="ginline" action={deleteTurnawayAction.bind(null, slug, r.id)} confirm="Remove this entry?"><button className="small ghost">Remove</button></ActionForm></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
