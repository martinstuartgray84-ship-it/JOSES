"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { FloorView } from "@/src/server/floor";
import type { Nudge, Stage, TimelineEvent } from "@/src/tables/coach";
import { formatMoney } from "@/src/pos/totals";

// JSON from the server: dates arrive as strings.
type Wire<T> = T extends Date ? string : T extends (infer U)[] ? Wire<U>[] : T extends object ? { [K in keyof T]: Wire<T[K]> } : T;

const STAGE: Record<Stage, string> = {
  seated: "Just seated",
  drinks: "Drinks",
  ordered: "Ordered",
  starters: "Starters",
  mains: "Mains",
  dessert: "After mains",
  finishing: "Finishing",
};
const STAGES: Stage[] = ["seated", "drinks", "ordered", "starters", "mains", "dessert", "finishing"];
const ICON: Partial<Record<TimelineEvent["kind"], string>> = {
  seated: "●",
  drinks: "🍷",
  food_order: "✎",
  starters_out: "①",
  mains_fired: "🔥",
  mains_out: "②",
  dessert: "③",
  hot: "☕",
  planned_end: "⏱",
  next_booking: "→",
};
const pounds = (p: number) => formatMoney(p).replace(/\.\d\d$/, "");
const hhmm = (d: string) => new Date(d).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });

export default function FloorCoach({ site, floor, now }: { site: { slug: string; name: string }; floor: Wire<FloorView>; now: string }) {
  const router = useRouter();
  const [server, setServer] = useState<string>("all");
  useEffect(() => {
    const id = setInterval(() => document.visibilityState === "visible" && router.refresh(), 20_000);
    return () => clearInterval(id);
  }, [router]);

  const servers = useMemo(() => {
    const m = new Map<string, { tables: number; covers: number; urgent: number; opportunity: number }>();
    for (const t of floor.tables) {
      const k = t.server ?? "Unassigned";
      const s = m.get(k) ?? { tables: 0, covers: 0, urgent: 0, opportunity: 0 };
      s.tables++;
      s.covers += t.covers;
      s.urgent += t.result.nudges.filter((n) => n.priority === 1).length;
      s.opportunity += t.result.opportunity;
      m.set(k, s);
    }
    return [...m.entries()].sort((a, b) => b[1].covers - a[1].covers);
  }, [floor.tables]);
  const shown = server === "all" ? floor.tables : floor.tables.filter((t) => (t.server ?? "Unassigned") === server);
  const T = floor.totals;

  return (
    <main className="page floor-page">
      <div className="page-head">
        <div>
          <h1>Floor · {site.name}</h1>
          <p className="muted small" style={{ margin: 0 }}>
            Tables ranked by what needs doing now. Updates every 20 seconds.
          </p>
        </div>
      </div>

      <section className="floor-totals" aria-label="Right now">
        <div className="ft">
          <span>Tables</span>
          <strong className="num">{T.tables}</strong>
        </div>
        <div className="ft">
          <span>Guests in</span>
          <strong className="num">{T.covers}</strong>
        </div>
        <div className="ft">
          <span>Spent so far</span>
          <strong className="num">{pounds(T.spend)}</strong>
        </div>
        <div className="ft">
          <span>Projected</span>
          <strong className="num">{pounds(T.projected)}</strong>
        </div>
        <div className="ft opp">
          <span>On the table now</span>
          <strong className="num">{pounds(T.opportunity)}</strong>
        </div>
        <div className={`ft ${T.urgent ? "urgent" : ""}`}>
          <span>Need attention</span>
          <strong className="num">{T.urgent}</strong>
        </div>
      </section>

      {servers.length > 0 && (
        <section className="server-strip" aria-label="Servers">
          <button type="button" className={server === "all" ? "on" : ""} onClick={() => setServer("all")}>
            Everyone
          </button>
          {servers.map(([name, s]) => (
            <button key={name} type="button" className={server === name ? "on" : ""} onClick={() => setServer(name)}>
              <strong>{name}</strong>
              <span className="small">
                {s.tables} tables · {s.covers} guests{s.urgent ? ` · ${s.urgent} to do` : ""}
              </span>
            </button>
          ))}
        </section>
      )}

      {shown.length === 0 && <p className="muted">No open tables.</p>}

      <div className="coach-grid">
        {shown.map((t) => {
          const r = t.result;
          const top = r.nudges[0];
          return (
            <article key={t.orderId} className={`coach-card ${top?.priority === 1 ? "p1" : top?.priority === 2 ? "p2" : ""}`}>
              <header>
                <div>
                  <h2>
                    {t.label} <span className="muted">· {t.covers} guests</span>
                  </h2>
                  <p className="small muted">
                    {t.server ?? "No server"} · seated {r.minutesSeated}m
                    {t.guestName && (
                      <>
                        {" "}
                        · {t.guestName}
                        {t.guestVisits >= 3 && <span className="chip good">★ {t.guestVisits} visits</span>}
                      </>
                    )}
                  </p>
                  {t.allergies && <p className="allergy-line">⚠ {t.allergies}</p>}
                </div>
                <Link href={`/pos/${site.slug}/check/${t.orderId}`} className="dbtn">
                  Check
                </Link>
              </header>

              <ol className="stages" aria-label={`Stage: ${STAGE[r.stage]}`}>
                {STAGES.map((s) => (
                  <li key={s} className={STAGES.indexOf(s) < STAGES.indexOf(r.stage) ? "done" : s === r.stage ? "now" : ""}>
                    <span>{STAGE[s]}</span>
                  </li>
                ))}
              </ol>

              <Journey events={r.timeline} now={now} />

              <div className="money">
                <div>
                  <span className="muted small">Spend a head</span>
                  <strong className="num">{formatMoney(r.spendPerHead)}</strong>
                  {r.expectedPerHead !== null && r.minutesSeated >= 10 && (
                    <span className={`small ${r.pace !== null && r.pace < 0.8 ? "behind" : r.pace !== null && r.pace > 1.15 ? "ahead" : "muted"}`}>
                      usually {pounds(r.expectedPerHead)} by now
                    </span>
                  )}
                </div>
                <div>
                  <span className="muted small">Bill so far</span>
                  <strong className="num">{formatMoney(r.spend)}</strong>
                  <span className="small muted">heading for ~{pounds(r.projectedTotal)}</span>
                </div>
                <div>
                  <span className="muted small">Drinks</span>
                  <strong className="num">{r.drinksPerCover}</strong>
                  <span className="small muted">
                    a head · {r.rounds} round{r.rounds === 1 ? "" : "s"}
                    {r.minutesSinceLastDrink !== null ? ` · last ${r.minutesSinceLastDrink}m ago` : ""}
                  </span>
                </div>
              </div>

              {r.nudges.length > 0 ? (
                <ul className="nudges">
                  {r.nudges.slice(0, 3).map((n) => (
                    <NudgeRow key={n.kind} n={n as unknown as Nudge} />
                  ))}
                </ul>
              ) : (
                <p className="all-good small">All on track.</p>
              )}
            </article>
          );
        })}
      </div>

      <details className="box rules">
        <summary>How the coach decides</summary>
        <ul className="small">
          <li><strong>Service first:</strong> no drinks 4 min after sitting down, drinks waiting 7 min at the bar, no food order after 12 min, starters cleared 12 min with mains still on hold.</li>
          <li><strong>Selling moments:</strong> next round 25 min after the last at dinner (30 at lunch), wine when mains go on with nothing to drink, starters right after a mains-only order, desserts 10 min after mains, coffee after dessert.</li>
          <li><strong>Turns:</strong> within 25 min of the next booking on the table, upsells stop and the coach says to keep things moving or bring the bill. Over time with nobody waiting is fine, and a chance to sell more.</li>
          <li><strong>Pace:</strong> spend a head is compared with what this site&rsquo;s tables usually spend by the same minute (lunch and dinner separately, last 8 weeks). Values are this site&rsquo;s average prices × how often guests usually say yes.</li>
        </ul>
      </details>
    </main>
  );
}

function NudgeRow({ n }: { n: Nudge }) {
  return (
    <li className={`nudge p${n.priority}`}>
      <div>
        <strong>{n.title}</strong>
        <span className="small">{n.detail}</span>
      </div>
      <div className="right">
        {n.value > 0 && n.priority < 3 && <span className="nv num">+{pounds(n.value)}</span>}
        {n.dueFor > 0 && <span className="small muted">{n.dueFor}m</span>}
      </div>
    </li>
  );
}

function Journey({ events, now }: { events: Wire<TimelineEvent>[]; now: string }) {
  const start = new Date(events[0]!.at).getTime();
  const nowT = new Date(now).getTime();
  const end = Math.max(nowT + 10 * 60_000, ...events.map((e) => new Date(e.at).getTime()));
  const x = (t: number) => `${((t - start) / (end - start)) * 100}%`;
  return (
    <div className="journey" aria-label="Table journey">
      <div className="j-track">
        <span className="j-done" style={{ width: x(nowT) }} />
        {events
          .filter((e) => e.kind !== "now")
          .map((e, i) => (
            <span
              key={i}
              className={`j-ev k-${e.kind} ${new Date(e.at).getTime() > nowT ? "future" : ""}`}
              style={{ left: x(new Date(e.at).getTime()) }}
              title={`${hhmm(e.at)} ${e.label}`}
            >
              {ICON[e.kind] ?? "•"}
            </span>
          ))}
        <span className="j-now" style={{ left: x(nowT) }} title={`Now ${hhmm(now)}`} />
      </div>
      <div className="j-labels small muted">
        <span>{hhmm(events[0]!.at)}</span>
        <span>
          {events
            .filter((e) => e.kind !== "now" && e.kind !== "seated" && new Date(e.at).getTime() <= nowT)
            .slice(-3)
            .map((e) => `${e.label} ${hhmm(e.at)}`)
            .join(" · ")}
        </span>
      </div>
    </div>
  );
}
