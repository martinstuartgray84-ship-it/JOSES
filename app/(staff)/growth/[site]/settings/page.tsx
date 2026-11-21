import { db } from "@/src/server/db";
import { DAY_KEYS, getSettings } from "@/src/server/growth";
import ActionForm from "../../ActionForm";
import { saveSettingsAction } from "../../actions";
import { growthSite } from "../../ctx";
import { Head } from "../../ui";

const DAY_NAMES: Record<string, string> = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };

export default async function Settings({ params }: { params: Promise<{ site: string }> }) {
  const { site: slug } = await params;
  const site = await growthSite(slug, "/settings");
  const s = await getSettings(db(), site.id);
  const areas = [...s.gainAreas, { name: "", captain: "" }, { name: "", captain: "" }];
  return (
    <>
      <Head title="Settings">For {site.name}. Seats drive every seat-hour figure, so set them before reading the scoreboard.</Head>
      <ActionForm action={saveSettingsAction.bind(null, slug)} keep>
        <div className="gcols">
          <section className="box">
            <h2>The room</h2>
            <div className="gform">
              <label>Seats in the room<input name="seats" type="number" min={1} required defaultValue={s.seats} /></label>
              <label>Of which bar seats<input name="barSeats" type="number" min={0} defaultValue={s.barSeats ?? ""} /></label>
              <label>Currency<input value="GBP, pounds" disabled readOnly /></label>
            </div>
            <h2 style={{ marginTop: 18 }}>Trading hours</h2>
            <div className="gdays">
              {DAY_KEYS.map((d) => {
                const h = s.tradingHours[d];
                return (
                  <div key={d}>
                    <span>{DAY_NAMES[d]}</span>
                    <label className="check small"><input type="checkbox" name={`closed_${d}`} value="1" defaultChecked={h === null} /> Closed</label>
                    <input type="time" name={`open_${d}`} defaultValue={h?.[0] ?? "12:00"} aria-label={`${DAY_NAMES[d]} opens`} />
                    <input type="time" name={`close_${d}`} defaultValue={h?.[1] ?? "23:00"} aria-label={`${DAY_NAMES[d]} closes`} />
                  </div>
                );
              })}
            </div>
            <p className="gnote">For reference. A trading day always runs 05:00 to 04:59, so sales after midnight count towards the night before.</p>
          </section>
          <section className="box">
            <h2>Gain areas and captains</h2>
            <div className="gareas">
              {areas.map((a, i) => (
                <div key={i}>
                  <input name="area_name" defaultValue={a.name} placeholder="Gain area" aria-label="Gain area" maxLength={60} />
                  <input name="area_captain" defaultValue={a.captain} placeholder="Captain" aria-label="Captain" maxLength={60} autoComplete="off" />
                </div>
              ))}
            </div>
            <p className="gnote">Clear a name to remove an area. People appear by display name only.</p>
            <h2 style={{ marginTop: 18 }}>Who sees what</h2>
            <div className="gform">
              <label className="wide">
                Figures for individual servers
                <select name="serverFiguresMinRole" defaultValue={s.serverFiguresMinRole === "owner" ? "manager" : s.serverFiguresMinRole}>
                  <option value="manager">Managers only (signed in on the till with a manager PIN)</option>
                  <option value="host">Everyone with staff access, captains included</option>
                </select>
              </label>
              <label className="wide">
                Email the Monday scorecard to
                <input name="scorecardEmails" defaultValue={s.scorecardEmails.join(", ")} placeholder="manager@example.com, owner@example.com" autoComplete="off" />
              </label>
            </div>
          </section>
        </div>
        <div className="btn-row" style={{ marginTop: 16 }}>
          <button className="primary">Save settings</button>
        </div>
      </ActionForm>
    </>
  );
}
