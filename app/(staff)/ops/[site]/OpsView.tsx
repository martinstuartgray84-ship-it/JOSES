"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import type { DayForecast, LiveOps } from "@/src/server/ops";
import type { OpsAlert } from "@/src/ops/ops";
import { LineChart } from "@/src/ui/charts";

const AREA: Record<OpsAlert["area"], string> = { kitchen: "Kitchen", bar: "Bar", floor: "Floor", door: "Door" };
const LEVEL = { ok: "OK", busy: "Busy", overloaded: "Overloaded" } as const;
const hh = (h: number) => `${String(h % 24).padStart(2, "0")}:00`;
const n1 = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

export default function OpsView({
  site,
  today,
  live,
  plan,
  nowHour,
}: {
  site: { slug: string; name: string };
  today: string;
  live: LiveOps;
  plan: DayForecast;
  nowHour: number;
}) {
  const router = useRouter();
  const isToday = plan.date === today;
  useEffect(() => {
    const id = setInterval(() => document.visibilityState === "visible" && router.refresh(), 20_000);
    return () => clearInterval(id);
  }, [router]);

  const labels = plan.hours.map((h) => hh(h.hour));
  const peak = plan.staffing.reduce((best, s) => (s.inHouse > (best?.inHouse ?? -1) ? s : best), plan.staffing[0]);
  const maxStaff = plan.staffing.reduce(
    (m, s) => ({ servers: Math.max(m.servers, s.servers), bar: Math.max(m.bar, s.bar), kitchen: Math.max(m.kitchen, s.kitchen) }),
    { servers: 0, bar: 0, kitchen: 0 },
  );

  return (
    <main className="page dash ops-page">
      <div className="page-head">
        <div>
          <h1>Operations · {site.name}</h1>
          <p className="muted small" style={{ margin: 0 }}>
            Bar, kitchen and floor load right now, and the plan for the day. Updates every 20 seconds.
          </p>
        </div>
      </div>

      <section className="box" aria-labelledby="now-h">
        <h2 id="now-h">Right now</h2>
        {live.alerts.length === 0 ? (
          <p className="all-good">Everything is flowing. No changes needed.</p>
        ) : (
          <ul className="ops-alerts">
            {live.alerts.map((a, i) => (
              <li key={i} className={`ops-alert s${a.severity}`}>
                <span className="ops-area">{AREA[a.area]}</span>
                <div>
                  <strong>{a.title}</strong>
                  <span className="small">{a.detail}</span>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="ops-grid">
          {live.stations.map((s) => (
            <article key={s.code} className={`ops-card lvl-${s.level}`}>
              <header>
                <h3>{s.name}</h3>
                <span className={`lvl lvl-${s.level}`}>{LEVEL[s.level]}</span>
              </header>
              <dl>
                <div><dt>Waiting</dt><dd className="num">{s.waiting}</dd></div>
                <div><dt>{s.kind === "bar" ? "Making" : "Cooking"}</dt><dd className="num">{s.cooking}</dd></div>
                <div><dt>Clears in</dt><dd className="num">{s.clearsInMinutes}m</dd></div>
                <div><dt>Oldest</dt><dd className="num">{s.oldestWaitMinutes}m</dd></div>
              </dl>
              <p className="small muted">
                {s.readyWaiting > 0 ? `${s.readyWaiting} ready for ${s.oldestReadyMinutes}m, waiting for a runner` : "Nothing waiting to go out"}
              </p>
            </article>
          ))}
          <article className="ops-card">
            <header>
              <h3>Floor</h3>
              <span className="muted small">{live.floor.covers} guests · {live.floor.tables} tables</span>
            </header>
            {live.servers.length === 0 ? (
              <p className="small muted">No open tables.</p>
            ) : (
              <ul className="srv">
                {live.servers.map((s) => (
                  <li key={s.name}>
                    <span className="srv-name">{s.name}</span>
                    <span className="srv-bar" aria-hidden>
                      <i className={`lvl-${s.level}`} style={{ width: `${Math.min(100, (s.covers / 24) * 100)}%` }} />
                    </span>
                    <span className="small num">
                      {s.covers} guests{s.urgent ? ` · ${s.urgent} overdue` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="small muted">
              {live.arrivingSoon} booked guests due in the next 30 min.
              {live.plan ? ` Plan this hour: ${live.plan.servers} on the floor, ${live.plan.bar} on bar, ${live.plan.kitchen} in the kitchen.` : ""}
            </p>
          </article>
        </div>
      </section>

      <section className="box" aria-labelledby="plan-h">
        <div className="plan-head">
          <h2 id="plan-h">Plan for {isToday ? "today" : new Date(`${plan.date}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" })}</h2>
          <input
            type="date"
            aria-label="Plan date"
            value={plan.date}
            onChange={(e) => e.target.value && router.push(`/ops/${site.slug}${e.target.value === today ? "" : `?date=${e.target.value}`}`)}
          />
        </div>
        <div className="tiles small-tiles plan-tiles">
          <div className="ft"><span>Expected covers</span><strong className="num">{plan.expectedCovers}</strong></div>
          <div className="ft"><span>Booked</span><strong className="num">{plan.bookedCovers}</strong></div>
          <div className="ft"><span>Peak in the room</span><strong className="num">{peak ? `${Math.round(peak.inHouse)} at ${hh(peak.hour)}` : "–"}</strong></div>
          <div className="ft"><span>Most staff needed</span><strong className="num">{maxStaff.servers} · {maxStaff.bar} · {maxStaff.kitchen}</strong><span>floor · bar · kitchen</span></div>
        </div>
        <p className="viz-note">
          Bookings, less a {Math.round(plan.noShowRate * 100)}% no-show rate, plus the walk-ins this site usually gets on this weekday
          {plan.weeksOfHistory ? ` (last ${plan.weeksOfHistory} weeks)` : " (no history yet)"}. Guests stay about {plan.dwellMinutes} min, order {n1(plan.usage.drinksPerCoverHour)} drinks an hour and {n1(plan.usage.platesPerCover)} plates each.
        </p>

        {plan.hours.length === 0 ? (
          <p className="muted">Closed: no services and no usual walk-ins on this day.</p>
        ) : (
          <>
            <LineChart
              title="Guests arriving by hour"
              labels={labels}
              series={[
                { id: "forecast", label: "Forecast", color: "var(--series-1)", values: plan.hours.map((h) => h.arrivals) },
                ...(plan.hours.some((h) => h.actual !== null)
                  ? [{ id: "actual", label: "Actual", color: "var(--series-2)", values: plan.hours.map((h) => h.actual) }]
                  : []),
              ]}
              format={n1}
            />

            <h3>Staff by hour</h3>
            <div className="tbl-wrap">
              <table className="tbl staffing">
                <caption className="sr-only">Staff needed by hour</caption>
                <thead>
                  <tr>
                    <th>Hour</th>
                    <th className="right">In the room</th>
                    <th className="right">Drinks</th>
                    <th className="right">Plates</th>
                    <th className="right">Floor</th>
                    <th className="right">Bar</th>
                    <th className="right">Kitchen</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.staffing.map((s) => (
                    <tr key={s.hour} className={isToday && s.hour === nowHour ? "now" : ""}>
                      <td>{hh(s.hour)}{isToday && s.hour === nowHour ? " · now" : ""}</td>
                      <td className="right num">{Math.round(s.inHouse)}</td>
                      <td className="right num">{s.drinks}</td>
                      <td className="right num">{s.plates}</td>
                      {(["servers", "bar", "kitchen"] as const).map((k) => (
                        <td key={k} className={`right num ${s[k] > 0 && s.tightest === k ? "tight" : ""}`} title={s.tightest === k ? "Busiest role this hour" : undefined}>
                          {s[k] || "–"}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="viz-note">
              One server per 16 guests, one bartender per 45 drinks an hour, one cook per 22 plates an hour. Bold marks the role under most pressure that hour: if you can only add one person, add them there.
            </p>
          </>
        )}

        <div className="two-col">
          <div>
            <h3>Kitchen prep</h3>
            {plan.prep.length === 0 ? (
              <p className="muted small">Not enough sales history yet.</p>
            ) : (
              <table className="tbl">
                <caption className="sr-only">Prep list</caption>
                <thead>
                  <tr><th>Dish</th><th className="right">Usually sell</th><th className="right">Prep</th></tr>
                </thead>
                <tbody>
                  {plan.prep.map((p) => (
                    <tr key={p.name}><td>{p.name}</td><td className="right num">{Math.round(p.expected)}</td><td className="right num"><strong>{p.prep}</strong></td></tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="viz-note">Expected covers × how often each dish sells per guest, plus 15% so you don&rsquo;t run out.</p>
          </div>
          <div>
            <h3>Bar: batch before the peak</h3>
            {plan.batch.length === 0 ? (
              <p className="muted small">No cocktail sells enough in the busiest hour to be worth batching.</p>
            ) : (
              <table className="tbl">
                <caption className="sr-only">Cocktails to batch</caption>
                <thead>
                  <tr><th>Cocktail</th><th className="right">In the peak hour</th></tr>
                </thead>
                <tbody>
                  {plan.batch.map((b) => (
                    <tr key={b.name}><td>{b.name}</td><td className="right num">{b.expected}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="viz-note">Pre-batch anything you&rsquo;ll make 6+ of in the busiest hour: each one then takes seconds, not minutes.</p>
          </div>
        </div>
      </section>
    </main>
  );
}
