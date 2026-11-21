import { db } from "@/src/server/db";
import { dataStatus, listImports, savedMappings } from "@/src/server/growth";
import ActionForm from "../../ActionForm";
import { clearDataAction, loadSampleAction } from "../../actions";
import { growthSite } from "../../ctx";
import { Head } from "../../ui";
import Uploader from "../../Uploader";

const TEMPLATES = {
  checks: "check_id,opened_at,closed_at,table,covers,server,net_total\nC1001,2026-11-14 19:05,2026-11-14 20:32,T7,2,Camila,71.50\nC1002,2026-11-14 19:10,2026-11-14 20:50,T12,4,Diego,148.00",
  items: "check_id,item,category,qty,net_price,unit_cost\nC1001,House margarita,Cocktail,2,20.00,2.10\nC1001,Al pastor tacos,Main,2,25.00,3.40",
  bookings: "booking_id,booked_for,party_size,status,channel,created_at\nB501,2026-11-14 19:00,2,seated,Direct web,2026-11-10 12:30\nB502,2026-11-14 20:00,4,no_show,Google,2026-11-13 09:15",
};
const n = (v: number) => v.toLocaleString("en-GB");
const day = (iso: string | null) => (iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "–");

export default async function Data({ params }: { params: Promise<{ site: string }> }) {
  const { site: slug } = await params;
  const site = await growthSite(slug, "/data");
  const sql = db();
  const [status, imports, saved] = await Promise.all([dataStatus(sql, site.id), listImports(sql, site.id), savedMappings(sql, site.id)]);
  return (
    <>
      <Head title="Data">Export three CSV files from the till and the booking system and load them here. Loading a file again replaces its rows and never duplicates them.</Head>
      <section className={`box ${status.checks ? "" : "gwarn"}`}>
        {status.checks ? (
          <p style={{ margin: 0 }}>
            <strong>{status.sample ? "Sample data loaded: " : "Loaded: "}</strong>
            {n(status.checks)} checks, {n(status.items)} item lines and {n(status.bookings)} bookings, {day(status.firstDay)} to {day(status.lastDay)}.
            {status.sample && " Every figure is invented, for a 60-seat site. Loading your own checks file on top would mix the two: clear the sample first."}
          </p>
        ) : (
          <p style={{ margin: 0 }}><strong>Nothing loaded yet.</strong> Start with the checks file, or load the sample to see every view working.</p>
        )}
        <div className="btn-row" style={{ marginTop: 12 }}>
          <ActionForm className="ginline" action={loadSampleAction.bind(null, slug)} confirm={status.checks ? "Replace everything loaded for this site with the invented sample data?" : undefined}>
            <button>{status.sample ? "Reload sample data" : "Load sample data"}</button>
          </ActionForm>
          {status.checks > 0 && (
            <ActionForm className="ginline" action={clearDataAction.bind(null, slug)} confirm="Remove all loaded checks, items, bookings and import history for this site? Ideas, tests and gains are kept.">
              <button className="ghost danger-outline">Clear loaded data</button>
            </ActionForm>
          )}
        </div>
      </section>
      <div className="gcols">
        <Uploader slug={slug} kind="checks" saved={saved.checks} blocked={status.sample ? "Clear the sample data before loading your own." : undefined} />
        <Uploader slug={slug} kind="items" saved={saved.items} blocked={status.sample ? "Clear the sample data before loading your own." : status.checks ? undefined : "Load the checks file first: item lines are matched to their check."} />
        <Uploader slug={slug} kind="bookings" saved={saved.bookings} blocked={status.sample ? "Clear the sample data before loading your own." : undefined} />
      </div>
      <section className="box">
        <h2>Import history</h2>
        {imports.length === 0 ? <p className="muted" style={{ margin: 0 }}>No files loaded yet.</p> : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>File</th><th>Loaded</th><th className="right">Rows read</th><th className="right">Loaded</th><th className="right">New</th><th className="right">Skipped</th><th>Dates covered</th><th>Report</th></tr></thead>
              <tbody>
                {imports.map((i) => {
                  const reasons = Object.entries(i.report.reasons ?? {});
                  return (
                    <tr key={i.id}>
                      <td>{i.filename}<div className="small muted">{i.kind}{i.sample ? " · sample" : ""}</div></td>
                      <td>{i.createdAt.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: site.timezone })}</td>
                      <td className="right num">{n(i.rowsRead)}</td>
                      <td className="right num">{n(i.rowsLoaded)}</td>
                      <td className="right num">{n(i.rowsNew)}</td>
                      <td className="right num">{i.rowsSkipped ? <strong className="bad-text">{n(i.rowsSkipped)}</strong> : 0}</td>
                      <td>{i.firstDay ? `${day(i.firstDay)} to ${day(i.lastDay)}` : "–"}</td>
                      <td>
                        {i.status === "failed" ? <span className="chip bad">Stopped part-way</span> : i.status === "loading" ? <span className="chip warn">Not finished</span> : reasons.length === 0 ? <span className="chip good">Clean</span> : null}
                        {(reasons.length > 0 || i.status === "failed") && (
                          <details>
                            <summary className="small">{reasons.length ? "Why rows were skipped" : "What happened"}</summary>
                            {i.status === "failed" && <p className="small">{String((i.report as unknown as { error?: string }).error ?? "The upload did not finish.")} Rows read before it stopped are loaded; load the file again to complete it.</p>}
                            <ul className="small" style={{ paddingLeft: 18, margin: "6px 0" }}>
                              {reasons.map(([reason, count]) => (<li key={reason}>{n(count)} × {reason}</li>))}
                            </ul>
                            {i.report.examples?.length > 0 && <p className="small muted" style={{ margin: 0 }}>First lines affected: {i.report.examples.slice(0, 12).map((e) => e.row).join(", ")}.</p>}
                          </details>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className="box">
        <h2>File templates</h2>
        <p className="small muted" style={{ marginTop: 0 }}>Column names are matched loosely, so &ldquo;Check ID&rdquo;, &ldquo;Opened At&rdquo; and &ldquo;Net Total&rdquo; also work, and you can match any other names by hand when you load a file. No guest names, emails or phone numbers are needed or stored.</p>
        <div className="gcols">
          {(Object.keys(TEMPLATES) as (keyof typeof TEMPLATES)[]).map((k) => (
            <div key={k}><h3>{k}.csv</h3><pre className="gpre">{TEMPLATES[k]}</pre></div>
          ))}
        </div>
      </section>
    </>
  );
}
