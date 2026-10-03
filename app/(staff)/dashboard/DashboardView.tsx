"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type {
  BookingStats,
  DailyRow,
  DishSpeed,
  GuestStats,
  HeatCell,
  HourSpeed,
  LiveNow,
  MenuEngineeringRow,
  ReasonRow,
  StaffRow,
  StageTimes,
  Summary,
} from "@/src/server/analytics";
import { formatMoney } from "@/src/pos/totals";
import { DataTable, HBars, Heatmap, LineChart, QuadrantScatter, StatTile, type Series } from "@/src/ui/charts";

interface Data {
  cur: Summary;
  before: Summary;
  days: DailyRow[];
  hours: HourSpeed[];
  stages: StageTimes;
  slow: DishSpeed[];
  menu: MenuEngineeringRow[];
  staff: StaffRow[];
  bookings: BookingStats;
  guests: GuestStats;
  heat: HeatCell[];
  reasons: ReasonRow[];
  live: LiveNow;
}

const pounds = (p: number) => formatMoney(p).replace(/\.00$/, "");
const compact = (p: number) => {
  const v = p / 100;
  if (v >= 1_000_000) return `£${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 10_000) return `£${Math.round(v / 1000)}K`;
  if (v >= 1000) return `£${(v / 1000).toFixed(1)}K`;
  return `£${Math.round(v)}`;
};
const mins = (m: number | null) => (m === null ? "–" : `${m.toFixed(1)} min`);
const pct = (f: number | null) => (f === null ? "–" : `${Math.round(f * 100)}%`);
const change = (a: number | null, b: number | null) => (a === null || b === null || b === 0 ? null : (a - b) / b);
const dayLabel = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

const CLASS_TEXT: Record<string, { title: string; advice: string }> = {
  star: { title: "Stars", advice: "Popular and profitable. Keep them prominent; don't touch the recipe." },
  plowhorse: { title: "Plowhorses", advice: "Popular, thin margin. Nudge the price or trim the cost." },
  puzzle: { title: "Puzzles", advice: "Profitable, rarely ordered. Move them up the menu, get staff to recommend them." },
  dog: { title: "Dogs", advice: "Neither. Rework or replace." },
};

export default function DashboardView({
  filters,
  sites,
  data,
}: {
  filters: { preset: string; from: string; to: string; site: string };
  sites: { slug: string; name: string; id: string }[];
  data: Data;
}) {
  const router = useRouter();
  const { cur, before } = data;
  const go = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams({ range: filters.preset, site: filters.site });
    if (filters.preset === "custom") {
      p.set("from", filters.from);
      p.set("to", filters.to);
    }
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) p.delete(k);
      else p.set(k, v);
    }
    if (p.get("range") !== "custom") {
      p.delete("from");
      p.delete("to");
    }
    if (p.get("site") === "all") p.delete("site");
    router.push(`/dashboard?${p}`);
  };

  // Every date in the range, so quiet days show as zero rather than vanishing.
  const dates = useMemo(() => {
    const out: string[] = [];
    for (let d = new Date(`${filters.from}T12:00:00Z`); d <= new Date(`${filters.to}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
      out.push(d.toISOString().slice(0, 10));
    }
    return out;
  }, [filters.from, filters.to]);

  const salesSeries: Series[] = useMemo(() => {
    const shown = filters.site === "all" ? sites : sites.filter((s) => s.slug === filters.site);
    return shown.map((s, i) => ({
      id: s.id,
      label: s.name,
      color: `var(--series-${i + 1})`,
      values: dates.map((d) => data.days.filter((r) => r.date === d && r.siteId === s.id).reduce((n, r) => n + r.sales, 0)),
    }));
  }, [data.days, dates, sites, filters.site]);

  const hourLabels = data.hours.map((h) => `${h.hour}:00`);
  const food = data.menu.filter((m) => m.group === "food" && m.unitMargin !== null);
  const foodAvgMargin = food.reduce((n, m) => n + m.unitMargin! * m.sold, 0) / Math.max(1, food.reduce((n, m) => n + m.sold, 0));
  const foodPopularAt = food.length ? 0.7 / food.length : 0;
  const includesToday = filters.to >= new Date().toISOString().slice(0, 10);

  return (
    <main className="page dash">
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <p className="muted small" style={{ margin: 0 }}>
            {dayLabel(filters.from)} – {dayLabel(filters.to)} · {filters.site === "all" ? "both sites" : sites.find((s) => s.slug === filters.site)?.name}
          </p>
        </div>
      </div>

      <div className="dash-filters" role="toolbar" aria-label="Filters">
        <div className="seg">
          <button aria-pressed={filters.site === "all"} onClick={() => go({ site: "all" })}>
            Both sites
          </button>
          {sites.map((s) => (
            <button key={s.slug} aria-pressed={filters.site === s.slug} onClick={() => go({ site: s.slug })}>
              {s.name}
            </button>
          ))}
        </div>
        <div className="seg">
          {[
            ["today", "Today"],
            ["7d", "7 days"],
            ["28d", "28 days"],
            ["90d", "90 days"],
          ].map(([k, l]) => (
            <button key={k} aria-pressed={filters.preset === k} onClick={() => go({ range: k! })}>
              {l}
            </button>
          ))}
        </div>
        <div className="dash-custom">
          <input type="date" aria-label="From" value={filters.from} max={filters.to} onChange={(e) => e.target.value && go({ range: "custom", from: e.target.value, to: filters.to })} />
          <span className="muted">to</span>
          <input type="date" aria-label="To" value={filters.to} min={filters.from} onChange={(e) => e.target.value && go({ range: "custom", from: filters.from, to: e.target.value })} />
        </div>
      </div>

      {includesToday && (
        <section className="box live" aria-label="Right now">
          <h2>Right now</h2>
          <div className="live-grid">
            <StatTile label="Open checks" value={String(data.live.openChecks)} hint={pounds(data.live.openValue) + " on them"} />
            <StatTile label="Guests in" value={String(data.live.coversIn)} />
            <StatTile label="Covers still due today" value={String(data.live.coversStillDue)} />
            <StatTile label="Food tickets cooking" value={String(data.live.ticketsCooking)} hint={data.live.ticketsLate ? `${data.live.ticketsLate} past target` : "all on time"} />
          </div>
        </section>
      )}

      <section className="tiles" aria-label="Headline numbers">
        <StatTile hero label="Sales" value={pounds(cur.sales)} delta={change(cur.sales, before.sales)} hint={`${pounds(cur.netSales)} ex VAT · service ${pounds(cur.service)} · tips ${pounds(cur.tips)}`} />
        <StatTile label="Covers" value={cur.covers.toLocaleString("en-GB")} delta={change(cur.covers, before.covers)} />
        <StatTile label="Spend per head" value={formatMoney(cur.spendPerHead)} delta={change(cur.spendPerHead, before.spendPerHead)} />
        <StatTile label="Checks" value={cur.checks.toLocaleString("en-GB")} delta={change(cur.checks, before.checks)} />
        <StatTile label="Time at table" value={cur.tableMinutes === null ? "–" : `${cur.tableMinutes} min`} delta={change(cur.tableMinutes, before.tableMinutes)} upIsGood={false} hint="median, seated to paid" />
      </section>

      <section className="box">
        <h2>Sales by day</h2>
        {cur.checks === 0 ? <p className="muted">No paid checks in this period.</p> : (
          <LineChart title="Sales by day" labels={dates} series={salesSeries} format={compact} tickLabel={(l) => dayLabel(l)} />
        )}
      </section>

      <div className="two-col">
        <section className="box">
          <h2>Service speed</h2>
          <div className="tiles small-tiles">
            <StatTile label="Drinks" value={mins(cur.drinksMinutes)} delta={change(cur.drinksMinutes, before.drinksMinutes)} upIsGood={false} hint="ordered → on the table" />
            <StatTile label="Food" value={mins(cur.foodMinutes)} delta={change(cur.foodMinutes, before.foodMinutes)} upIsGood={false} hint="fired → on the table" />
            <StatTile label="Late food tickets" value={pct(cur.lateTicketShare)} delta={change(cur.lateTicketShare, before.lateTicketShare)} upIsGood={false} hint=">2 min past target" />
          </div>
          <p className="stages small">
            Where food time goes: <strong>{mins(data.stages.kitchen)}</strong> cooking, then <strong>{mins(data.stages.pass)}</strong> waiting on the pass.
            Bar makes a drink in <strong>{mins(data.stages.bar)}</strong>.
          </p>
          {data.hours.length > 0 && (
            <>
              <h3>By hour sent (median minutes)</h3>
              <LineChart
                title="Service speed by hour"
                labels={hourLabels}
                height={200}
                format={(v) => `${Math.round(v)}m`}
                series={[
                  { id: "drinks", label: "Drinks", color: "var(--series-1)", values: data.hours.map((h) => h.drinks) },
                  { id: "food", label: "Food", color: "var(--series-2)", values: data.hours.map((h) => h.food) },
                ]}
              />
            </>
          )}
        </section>

        <section className="box">
          <h2>Slowest dishes</h2>
          <p className="muted small" style={{ marginTop: 0 }}>
            Median cooking time (started → ready) against the prep time on the menu. Fix the recipe, the mise en place, or the
            number on the menu: sequencing relies on it.
          </p>
          {data.slow.length === 0 ? <p className="muted">Not enough tickets yet.</p> : (
            <div className="tbl-wrap"><table className="tbl">
              <thead>
                <tr>
                  <th>Dish</th>
                  <th className="right">Sold</th>
                  <th className="right">Menu says</th>
                  <th className="right">Takes</th>
                  <th className="right">Over</th>
                </tr>
              </thead>
              <tbody>
                {data.slow.map((d) => (
                  <tr key={d.name}>
                    <td>{d.name}</td>
                    <td className="right num">{d.count}</td>
                    <td className="right num">{d.prepMinutes}m</td>
                    <td className="right num">{d.medianMinutes}m</td>
                    <td className={`right num ${d.overBy > 3 ? "bad-text" : ""}`}>{d.overBy > 0 ? `+${d.overBy}m` : `${d.overBy}m`}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </section>
      </div>

      <section className="box">
        <h2>Menu engineering · food</h2>
        <p className="muted small" style={{ marginTop: 0 }}>
          Each dot is a dish: how often it&rsquo;s ordered against what it earns per plate (ex VAT, after food cost). Lines are the
          averages. Dishes without a cost on the menu are left out.
        </p>
        {food.length === 0 ? <p className="muted">Add costs to menu items to see this.</p> : (
          <>
            <QuadrantScatter
              title="Menu engineering"
              points={food.map((m) => ({
                id: m.name,
                label: m.name,
                x: m.mix,
                y: m.unitMargin!,
                detail: `${m.sold} sold · ${formatMoney(m.unitMargin!)} margin each · ${formatMoney(m.totalMargin!)} total`,
                emphasis: m.class === "star" || m.class === "dog",
              }))}
              xLine={foodPopularAt}
              yLine={foodAvgMargin}
              xLabel="Share of food orders"
              yLabel="Margin per plate"
              formatX={(v) => `${Math.round(v * 100)}%`}
              formatY={compact}
              quadrants={["Stars", "Puzzles", "Plowhorses", "Dogs"]}
            />
            <div className="classes">
              {(["star", "plowhorse", "puzzle", "dog"] as const).map((c) => {
                const items = data.menu.filter((m) => m.class === c && m.group === "food");
                return (
                  <div key={c} className="class-box">
                    <h3>
                      {CLASS_TEXT[c]!.title} <span className="muted">({items.length})</span>
                    </h3>
                    <p className="muted small">{CLASS_TEXT[c]!.advice}</p>
                    <p className="small">{items.map((m) => m.name).join(", ") || "None"}</p>
                  </div>
                );
              })}
            </div>
            <p className="small" style={{ margin: "10px 0 0" }}>
              <strong>Drinks</strong> (judged against other drinks):{" "}
              {(["star", "plowhorse", "puzzle", "dog"] as const)
                .map((c) => {
                  const d = data.menu.filter((m) => m.group === "drink" && m.class === c);
                  return d.length ? `${CLASS_TEXT[c]!.title.toLowerCase()}: ${d.map((m) => m.name).join(", ")}` : null;
                })
                .filter(Boolean)
                .join(" · ") || "add costs to drinks to see this"}
            </p>
            <DataTable
              caption="Menu engineering"
              head={["Item", "Group", "Sold", "Mix", "Revenue", "Margin each", "Class"]}
              rows={data.menu.map((m) => [m.name, m.group, m.sold, pct(m.mix), formatMoney(m.revenue), m.unitMargin === null ? "–" : formatMoney(m.unitMargin), m.class ? CLASS_TEXT[m.class]!.title : "no cost"])}
            />
          </>
        )}
      </section>

      <div className="two-col">
        <section className="box">
          <h2>When you&rsquo;re busy</h2>
          <p className="muted small" style={{ marginTop: 0 }}>Covers seated by day and hour.</p>
          {data.heat.length === 0 ? <p className="muted">No covers yet.</p> : <Heatmap title="Covers by weekday and hour" cells={data.heat.map((c) => ({ dow: c.dow, hour: c.hour, value: c.covers }))} unit="covers" />}
        </section>

        <section className="box">
          <h2>Bookings</h2>
          <div className="tiles small-tiles">
            <StatTile label="Bookings" value={String(data.bookings.bookings)} hint={`${data.bookings.coversBooked} covers`} />
            <StatTile label="No-show rate" value={pct(data.bookings.noShowRate)} hint={`${data.bookings.noShows} no-shows`} />
            <StatTile label="Cancelled" value={String(data.bookings.cancelled)} />
            <StatTile label="Booked ahead" value={data.bookings.medianLeadDays === null ? "–" : `${data.bookings.medianLeadDays} days`} hint="median" />
            <StatTile label="Walk-ins" value={pct(data.bookings.walkInShare)} hint="of paid checks" />
          </div>
          {data.bookings.byChannel.length > 0 && (
            <>
              <h3>Where bookings come from</h3>
              <HBars title="Bookings by channel" rows={data.bookings.byChannel.map((c) => ({ label: c.channel.replace("_", " "), value: c.bookings }))} format={(v) => String(v)} />
            </>
          )}
        </section>
      </div>

      <div className="two-col">
        <section className="box">
          <h2>Guests</h2>
          <div className="tiles small-tiles">
            <StatTile label="Guests (known)" value={String(data.guests.guests)} />
            <StatTile label="Came back" value={pct(data.guests.repeatRate)} hint={`${data.guests.returning} returning, ${data.guests.newGuests} new`} />
          </div>
          <h3>Top guests this period</h3>
          <div className="tbl-wrap"><table className="tbl">
            <thead>
              <tr>
                <th>Guest</th>
                <th className="right">Visits</th>
                <th className="right">Spend</th>
              </tr>
            </thead>
            <tbody>
              {data.guests.top.map((g) => (
                <tr key={g.id}>
                  <td>
                    <Link href={`/guests/${g.id}`}>{g.name || "Guest"}</Link>
                  </td>
                  <td className="right num">{g.visits}</td>
                  <td className="right num">{formatMoney(g.spend)}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </section>

        <section className="box">
          <h2>Team</h2>
          <div className="tbl-wrap"><table className="tbl">
            <thead>
              <tr>
                <th>Server</th>
                <th className="right">Checks</th>
                <th className="right">Covers</th>
                <th className="right">Sales</th>
                <th className="right">Per head</th>
                <th className="right">Tips</th>
              </tr>
            </thead>
            <tbody>
              {data.staff.map((s) => (
                <tr key={s.name}>
                  <td>{s.name}</td>
                  <td className="right num">{s.checks}</td>
                  <td className="right num">{s.covers}</td>
                  <td className="right num">{pounds(s.sales)}</td>
                  <td className="right num">{formatMoney(s.spendPerHead)}</td>
                  <td className="right num">{pounds(s.tips)}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
          <h3>Comps, voids and discounts</h3>
          <p className="small" style={{ marginTop: 0 }}>
            Comps <strong>{pounds(cur.comps)}</strong> · voids <strong>{pounds(cur.voids)}</strong> · discounts <strong>{pounds(cur.discounts)}</strong>
          </p>
          {data.reasons.length > 0 && (
            <div className="tbl-wrap"><table className="tbl">
              <tbody>
                {data.reasons.slice(0, 6).map((x) => (
                  <tr key={x.kind + x.reason}>
                    <td>
                      <span className={`chip ${x.kind === "void" ? "bad" : "warn"}`}>{x.kind}</span> {x.reason}
                    </td>
                    <td className="right num">{x.count}×</td>
                    <td className="right num">{formatMoney(x.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </section>
      </div>

      <details className="box defs">
        <summary>How these are worked out</summary>
        <ul className="small">
          <li><strong>Sales</strong>: what guests paid for food and drink, including VAT and after discounts. Service charge and tips are shown separately.</li>
          <li><strong>Covers</strong>: guests on paid checks. <strong>Spend per head</strong> = sales ÷ covers.</li>
          <li><strong>Drinks time</strong>: from the order being taken to the drink being served. <strong>Food time</strong>: from the course being fired to the plate reaching the table.</li>
          <li><strong>Late food ticket</strong>: ready more than 2 minutes after its target (fired time plus its longest prep time).</li>
          <li><strong>Menu engineering</strong>: food and drinks are judged separately. Popular = at least 70% of an even share of orders. Profitable = margin per plate at or above the weighted average.</li>
          <li><strong>No-show rate</strong>: no-shows ÷ (no-shows + bookings that turned up). Changes are against the same number of days just before.</li>
        </ul>
      </details>
    </main>
  );
}
