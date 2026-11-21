// Server-rendered pieces shared by the Growth views.

import Link from "next/link";
import { fmt, hourLabel, pctChange, type Heat, type Tile } from "@/src/growth/engine";

export function Head({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <header className="ghead">
      <h1>{title}</h1>
      {children && <p className="muted">{children}</p>}
    </header>
  );
}

export function NoData({ slug, what = "This view" }: { slug: string; what?: string }) {
  return (
    <div className="box gempty">
      <p>
        <strong>No till data loaded yet.</strong> {what} fills in once a checks file is loaded.
      </p>
      <p>
        <Link className="gbtn primary" href={`/growth/${slug}/data`}>
          Load data
        </Link>
      </p>
    </div>
  );
}

export function Delta({ change, better, label = "on prior" }: { change: number | null; better: 1 | -1; label?: string }) {
  if (change == null) return <span className="chip">No earlier period</span>;
  const tone = Math.abs(change) < 0.005 ? "" : change * better > 0 ? "good" : "bad";
  return (
    <span className={`chip ${tone}`}>
      {change > 0 ? "▲ " : change < 0 ? "▼ " : ""}
      {pctChange(Math.abs(change)).replace("+", "")} {label}
    </span>
  );
}

export function Tiles({ tiles }: { tiles: Tile[] }) {
  return (
    <div className="gtiles">
      {tiles.map((t) => (
        <div key={t.key} className="stat-tile">
          <span className="st-label">{t.label}</span>
          <span className="st-value num">{fmt(t.fmt, t.value)}</span>
          <Delta change={t.change} better={t.better} />
        </div>
      ))}
    </div>
  );
}

export function Stat({ label, value, hint, children }: { label: string; value: string; hint?: string; children?: React.ReactNode }) {
  return (
    <div className="stat-tile">
      <span className="st-label">{label}</span>
      <span className="st-value num">{value}</span>
      {hint && <span className="st-hint muted">{hint}</span>}
      {children}
    </div>
  );
}

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** RevPASH or occupancy by day of week and hour, value printed in each cell. */
export function HeatGrid({ heat, mode }: { heat: Heat; mode: "rev" | "occ" }) {
  const hours = Array.from({ length: heat.hmax - heat.hmin + 1 }, (_, i) => heat.hmin + i);
  return (
    <div className="tbl-wrap">
      <table className="gheat">
        <caption className="sr-only">{mode === "rev" ? "Net sales per available seat-hour in pounds" : "Seat occupancy"}, by day of week and hour</caption>
        <thead>
          <tr>
            <td />
            {hours.map((h) => (
              <th key={h} scope="col">
                {hourLabel(h)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {heat.grid.map((row, d) => (
            <tr key={d}>
              <th scope="row">{DAYS[d]}</th>
              {row.cells.map((c, i) => {
                if (!c) return <td key={i} className="off">·</td>;
                const v = mode === "rev" ? c.rev : c.occ;
                const pct = Math.round(Math.min(1, v / (mode === "rev" ? heat.peak || 1 : 1)) * 100);
                return (
                  <td key={i} className={pct > 62 ? "hi" : ""} style={{ ["--p" as string]: `${pct}%` }}>
                    {mode === "rev" ? v.toFixed(1) : `${Math.round(v * 100)}%`}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Seg({ options, value }: { options: { href: string; label: string; key: string }[]; value: string }) {
  return (
    <div className="seg" role="group">
      {options.map((o) => (
        <Link key={o.key} href={o.href} aria-pressed={o.key === value} scroll={false}>
          {o.label}
        </Link>
      ))}
    </div>
  );
}
