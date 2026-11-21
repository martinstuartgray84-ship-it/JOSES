import { db } from "@/src/server/db";
import { listEnquiries, listEvents, type Enquiry, type EventRow } from "@/src/server/growth-programme";
import { SLOTS, fmt, heat, minSpendGrid } from "@/src/growth/engine";
import ActionForm from "../../ActionForm";
import { deleteEnquiryAction, deleteEventAction, saveEnquiryAction, saveEventAction } from "../../actions";
import { growthCtx, one, withPeriod, type SP } from "../../ctx";
import { Head, Seg, Stat } from "../../ui";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const OUTCOMES = { open: "Open", booked: "Booked", lost: "Lost", no_reply: "No reply from guest" } as const;
const day = (iso: string | null) => (iso ? new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit", timeZone: "UTC" }) : "–");
const hours = (h: number | null) => (h == null ? "–" : h < 1 ? `${Math.round(h * 60)} min` : h < 48 ? `${h.toFixed(1)} h` : `${Math.round(h / 24)} days`);

function EnquiryFields({ e, now }: { e?: Enquiry; now: string }) {
  return (
    <>
      {e && <input type="hidden" name="id" value={e.id} />}
      <label>Received<input name="receivedAt" type="datetime-local" required defaultValue={e?.receivedAt ?? now} /></label>
      <label>First reply sent<input name="firstReplyAt" type="datetime-local" defaultValue={e?.firstReplyAt ?? ""} /></label>
      <label>Source<input name="source" maxLength={80} defaultValue={e?.source ?? ""} placeholder="Website, phone, walk-in" /></label>
      <label>Type<input name="eventType" maxLength={80} defaultValue={e?.eventType ?? ""} placeholder="Birthday, corporate, full hire" /></label>
      <label>Date wanted<input name="requestedFor" type="date" defaultValue={e?.requestedFor ?? ""} /></label>
      <label>Guests<input name="partySize" type="number" min={1} defaultValue={e?.partySize ?? ""} /></label>
      <label>Quote, £<input name="quote" inputMode="decimal" defaultValue={e?.quote ?? ""} /></label>
      <label>
        Outcome
        <select name="outcome" defaultValue={e?.outcome ?? "open"}>
          {Object.entries(OUTCOMES).map(([k, v]) => (<option key={k} value={k}>{v}</option>))}
        </select>
      </label>
      <label>Reason lost<input name="lostReason" maxLength={300} defaultValue={e?.lostReason ?? ""} placeholder="Price, date taken, went quiet" /></label>
    </>
  );
}

function EventFields({ e, today }: { e?: EventRow; today: string }) {
  return (
    <>
      {e && <input type="hidden" name="id" value={e.id} />}
      <label>Name<input name="name" required maxLength={120} defaultValue={e?.name ?? ""} /></label>
      <label>Date<input name="heldOn" type="date" required defaultValue={e?.heldOn ?? today} /></label>
      <label>Space<input name="space" maxLength={80} defaultValue={e?.space ?? ""} placeholder="Whole room, bar, mezzanine" /></label>
      <label>Guests<input name="guests" type="number" min={0} defaultValue={e?.guests ?? ""} /></label>
      <label>Revenue, net £<input name="revenue" inputMode="decimal" required defaultValue={e?.revenue ?? ""} /></label>
      <label>Cost of goods, £<input name="costOfGoods" inputMode="decimal" defaultValue={e?.costOfGoods ?? ""} /></label>
      <label>Extra labour, £<input name="extraLabour" inputMode="decimal" defaultValue={e?.extraLabour ?? ""} /></label>
      <label>Direct costs, £<input name="directCosts" inputMode="decimal" defaultValue={e?.directCosts ?? ""} /></label>
      <label>Normal sales displaced, £<input name="displacedSales" inputMode="decimal" defaultValue={e?.displacedSales ?? ""} /></label>
      <label>Contribution rate, %<input name="contributionRate" type="number" min={0} max={100} step={1} defaultValue={e ? Math.round(e.contributionRate * 100) : 55} /></label>
    </>
  );
}

export default async function Events({ params, searchParams }: { params: Promise<{ site: string }>; searchParams: SP }) {
  const { site: slug } = await params;
  const c = await growthCtx(slug, searchParams, "/events");
  const sql = db();
  const [enquiries, events, [clock], sp] = await Promise.all([
    listEnquiries(sql, c.site.id),
    listEvents(sql, c.site.id),
    sql`select to_char(now() at time zone ${c.site.timezone}, 'YYYY-MM-DD"T"HH24:MI') as now`,
    searchParams,
  ]);
  const now = clock!.now as string;
  const premium = [0, 10, 20, 30, 50].includes(Number(one(sp.premium))) ? Number(one(sp.premium)) : 20;
  const grid = c.model && c.period ? minSpendGrid(heat(c.model, c.period.from, c.period.to, c.settings.seats), c.settings.seats, premium / 100) : null;
  const closed = enquiries.filter((e) => e.outcome === "booked" || e.outcome === "lost" || e.outcome === "no_reply");
  const replies = enquiries.map((e) => e.responseHours).filter((h): h is number => h != null).sort((a, b) => a - b);
  const median = replies.length ? (replies[Math.floor((replies.length - 1) / 2)]! + replies[Math.ceil((replies.length - 1) / 2)]!) / 2 : null;
  const base = `/growth/${slug}/events`;
  return (
    <>
      <Head title="Events and hire">Log every enquiry, record what each event really made once displaced sales are counted, and quote from a minimum spend grid.</Head>
      <div className="gtiles">
        <Stat label="Enquiries logged" value={fmt("int", enquiries.length)} />
        <Stat label="Booked, of those closed" value={closed.length ? fmt("pct0", closed.filter((e) => e.outcome === "booked").length / closed.length) : "No data"} />
        <Stat label="Typical time to first reply" value={hours(median)} hint="Median" />
        <Stat label="Net gain from events" value={fmt("money0", events.reduce((a, e) => a + e.netGain, 0))} hint={`${events.length} recorded`} />
      </div>

      <section className="box">
        <div className="gbar">
          <h2>Minimum spend to take the whole room</h2>
          <Seg value={String(premium)} options={[0, 10, 20, 30, 50].map((p) => ({ key: String(p), label: p ? `+${p}%` : "Break-even", href: withPeriod(base, c.weeks, p === 20 ? {} : { premium: String(p) }) }))} />
        </div>
        {grid ? (
          <>
            <div className="tbl-wrap">
              <table className="tbl">
                <thead><tr><th>Day</th>{SLOTS.map((s) => (<th key={s.key} className="right">{s.label}</th>))}</tr></thead>
                <tbody>
                  {grid.map((row, d) => (
                    <tr key={d}>
                      <td>{DAYS[d]}</td>
                      {row.map((cell, i) => (
                        <td key={i} className="right num">{cell ? (<><strong>{fmt("money0", Math.ceil(cell.minimum / 50) * 50)}</strong><div className="small muted">normally {fmt("money0", cell.normal)}</div></>) : <span className="muted">Closed</span>}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="gnote">Normal net sales for that day and slot over {c.period!.label}, plus {premium}%, rounded up to £50. Net of VAT and service charge. Below this, a hire loses money against a normal night.</p>
          </>
        ) : (
          <p className="muted" style={{ margin: 0 }}>Load till data to see what each slot normally takes.</p>
        )}
      </section>

      <section className="box">
        <h2>Enquiry log</h2>
        <details className="gadd" open={enquiries.length === 0}>
          <summary><span className="gbtn small">Log an enquiry</span></summary>
          <ActionForm action={saveEnquiryAction.bind(null, slug)} className="gform"><EnquiryFields now={now} /><button className="primary">Save enquiry</button></ActionForm>
        </details>
        {enquiries.length > 0 && (
          <div className="tbl-wrap" style={{ marginTop: 12 }}>
            <table className="tbl">
              <thead><tr><th>Received</th><th>Source and type</th><th>Wanted</th><th className="right">Guests</th><th className="right">Quote</th><th className="right">First reply</th><th>Outcome</th><th /></tr></thead>
              <tbody>
                {enquiries.map((e) => (
                  <tr key={e.id}>
                    <td>{day(e.receivedAt)}</td>
                    <td>{[e.source, e.eventType].filter(Boolean).join(" · ") || "–"}</td>
                    <td>{day(e.requestedFor)}</td>
                    <td className="right num">{e.partySize ?? "–"}</td>
                    <td className="right num">{e.quote == null ? "–" : fmt("money0", e.quote)}</td>
                    <td className="right num">{hours(e.responseHours)}</td>
                    <td><span className={`chip ${e.outcome === "booked" ? "good" : e.outcome === "lost" ? "bad" : e.outcome === "open" ? "info" : ""}`}>{OUTCOMES[e.outcome]}</span>{e.lostReason && <div className="small muted">{e.lostReason}</div>}</td>
                    <td>
                      <details>
                        <summary className="small">Edit</summary>
                        <ActionForm action={saveEnquiryAction.bind(null, slug)} className="gform" keep><EnquiryFields e={e} now={now} /><button className="primary">Save</button></ActionForm>
                        <ActionForm action={deleteEnquiryAction.bind(null, slug, e.id)} confirm="Remove this enquiry from the log?"><button className="small ghost danger-outline" style={{ marginTop: 8 }}>Remove</button></ActionForm>
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="box">
        <h2>Event records</h2>
        <details className="gadd" open={events.length === 0}>
          <summary><span className="gbtn small">Record an event</span></summary>
          <ActionForm action={saveEventAction.bind(null, slug)} className="gform"><EventFields today={now.slice(0, 10)} /><button className="primary">Save event</button></ActionForm>
        </details>
        {events.length > 0 && (
          <div className="tbl-wrap" style={{ marginTop: 12 }}>
            <table className="tbl">
              <thead><tr><th>Event</th><th className="right">Revenue</th><th className="right">Cost of goods</th><th className="right">Labour</th><th className="right">Direct</th><th className="right">Displaced × rate</th><th className="right">Net gain</th><th /></tr></thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.id}>
                    <td>{e.name}<div className="small muted">{day(e.heldOn)}{e.space ? ` · ${e.space}` : ""}{e.guests ? ` · ${e.guests} guests` : ""}</div></td>
                    <td className="right num">{fmt("money0", e.revenue)}</td>
                    <td className="right num">{fmt("money0", e.costOfGoods)}</td>
                    <td className="right num">{fmt("money0", e.extraLabour)}</td>
                    <td className="right num">{fmt("money0", e.directCosts)}</td>
                    <td className="right num">{fmt("money0", e.displacedSales)} × {fmt("pct0", e.contributionRate)}</td>
                    <td className="right num"><strong className={e.netGain < 0 ? "bad-text" : ""}>{fmt("money0", e.netGain)}</strong></td>
                    <td>
                      <details>
                        <summary className="small">Edit</summary>
                        <ActionForm action={saveEventAction.bind(null, slug)} className="gform" keep><EventFields e={e} today={now.slice(0, 10)} /><button className="primary">Save</button></ActionForm>
                        <ActionForm action={deleteEventAction.bind(null, slug, e.id)} confirm="Remove this event record?"><button className="small ghost danger-outline" style={{ marginTop: 8 }}>Remove</button></ActionForm>
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="gnote">Net gain = revenue − cost of goods − extra labour − direct costs − (normal net sales displaced × contribution rate).</p>
      </section>
    </>
  );
}
