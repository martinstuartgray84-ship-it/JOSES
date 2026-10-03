"use client";

// Small SVG charts for the dashboard. Thin marks, one axis, recessive grid,
// hover tooltips, legends for 2+ series, and every chart has a table view.

import { useId, useMemo, useRef, useState } from "react";

export interface Series {
  id: string;
  label: string;
  /** CSS colour, normally var(--series-N). */
  color: string;
  values: (number | null)[];
}

/** Round axis ticks: 0, 2, 4… / 0, 500, 1,000… */
export function niceTicks(max: number, count = 4): number[] {
  if (!(max > 0)) return [0, 1];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const ticks = [];
  for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  if (ticks[ticks.length - 1]! < max) ticks.push(ticks[ticks.length - 1]! + step);
  return ticks;
}

function Tooltip({ x, y, width, children }: { x: number; y: number; width: number; children: React.ReactNode }) {
  const left = x > width * 0.6 ? undefined : x + 12;
  const right = x > width * 0.6 ? width - x + 12 : undefined;
  return (
    <div className="viz-tip" style={{ left, right, top: Math.max(0, y - 8) }} role="status">
      {children}
    </div>
  );
}

export function LineChart(props: {
  labels: string[];
  series: Series[];
  format: (v: number) => string;
  height?: number;
  /** Short x labels; defaults to the labels themselves. */
  tickLabel?: (label: string, i: number) => string;
  title: string;
}) {
  const { labels, series, format } = props;
  const height = props.height ?? 220;
  const width = 640;
  const pad = { l: 56, r: 72, t: 12, b: 28 };
  const [hover, setHover] = useState<number | null>(null);
  const ref = useRef<SVGSVGElement>(null);
  const max = Math.max(0, ...series.flatMap((s) => s.values.filter((v): v is number => v !== null)));
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1]!;
  const x = (i: number) => pad.l + (labels.length <= 1 ? 0.5 : i / (labels.length - 1)) * (width - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - v / top) * (height - pad.t - pad.b);
  const every = Math.max(1, Math.ceil(labels.length / 8));

  const onMove = (e: React.PointerEvent) => {
    const box = ref.current!.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * width;
    const i = Math.round(((px - pad.l) / (width - pad.l - pad.r)) * (labels.length - 1));
    setHover(Math.max(0, Math.min(labels.length - 1, i)));
  };

  return (
    <figure className="viz">
      {series.length > 1 && (
        <figcaption className="viz-legend">
          {series.map((s) => (
            <span key={s.id}>
              <i style={{ background: s.color }} /> {s.label}
            </span>
          ))}
        </figcaption>
      )}
      <div className="viz-plot">
        <svg
          ref={ref}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={props.title}
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line className="viz-grid" x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} />
              <text className="viz-axis" x={pad.l - 8} y={y(t)} textAnchor="end" dominantBaseline="middle">
                {format(t)}
              </text>
            </g>
          ))}
          {labels.map((l, i) =>
            i % every === 0 || i === labels.length - 1 ? (
              <text key={l} className="viz-axis" x={x(i)} y={height - 8} textAnchor="middle">
                {props.tickLabel ? props.tickLabel(l, i) : l}
              </text>
            ) : null,
          )}
          {series.map((s) => {
            const pts = s.values.map((v, i) => (v === null ? null : `${x(i)},${y(v)}`));
            const segments: string[] = [];
            let cur: string[] = [];
            for (const p of pts) {
              if (p) cur.push(p);
              else if (cur.length) {
                segments.push(cur.join(" "));
                cur = [];
              }
            }
            if (cur.length) segments.push(cur.join(" "));
            const lastIdx = s.values.map((v, i) => (v === null ? -1 : i)).filter((i) => i >= 0).pop();
            return (
              <g key={s.id}>
                {segments.map((seg, k) => (
                  <polyline key={k} points={seg} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                ))}
                {lastIdx !== undefined && (
                  <>
                    <circle cx={x(lastIdx)} cy={y(s.values[lastIdx]!)} r={4} fill={s.color} stroke="var(--viz-surface)" strokeWidth={2} />
                    {series.length <= 4 && (
                      <text className="viz-label" x={x(lastIdx) + 8} y={y(s.values[lastIdx]!)} dominantBaseline="middle">
                        {format(s.values[lastIdx]!)}
                      </text>
                    )}
                  </>
                )}
              </g>
            );
          })}
          {hover !== null && (
            <g>
              <line className="viz-cross" x1={x(hover)} x2={x(hover)} y1={pad.t} y2={height - pad.b} />
              {series.map((s) =>
                s.values[hover] == null ? null : (
                  <circle key={s.id} cx={x(hover)} cy={y(s.values[hover]!)} r={5} fill={s.color} stroke="var(--viz-surface)" strokeWidth={2} />
                ),
              )}
            </g>
          )}
        </svg>
        {hover !== null && (
          <Tooltip x={ref.current ? (x(hover) / width) * ref.current.clientWidth : 0} y={8} width={ref.current?.clientWidth ?? width}>
            <strong>{labels[hover]}</strong>
            {series.map((s) => (
              <div key={s.id} className="viz-tip-row">
                <i style={{ background: s.color }} /> {s.label} <b>{s.values[hover] == null ? "–" : format(s.values[hover]!)}</b>
              </div>
            ))}
          </Tooltip>
        )}
      </div>
      <DataTable
        caption={props.title}
        head={["", ...series.map((s) => s.label)]}
        rows={labels.map((l, i) => [l, ...series.map((s) => (s.values[i] == null ? "–" : format(s.values[i]!)))])}
      />
    </figure>
  );
}

export function DataTable(props: { caption: string; head: string[]; rows: (string | number)[][] }) {
  return (
    <details className="viz-table">
      <summary>Show as table</summary>
      <div className="tbl-wrap">
        <table className="tbl">
          <caption className="sr-only">{props.caption}</caption>
          <thead>
            <tr>
              {props.head.map((h, i) => (
                <th key={i} className={i ? "right" : ""}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {props.rows.map((r, i) => (
              <tr key={i}>
                {r.map((c, j) => (
                  <td key={j} className={j ? "right num" : ""}>
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
// Sequential blue, light → dark (reference ramp steps 100–700).
const RAMP = ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95", "#0d366b"];

export function Heatmap(props: { cells: { dow: number; hour: number; value: number }[]; title: string; unit: string }) {
  const hours = useMemo(() => {
    const hs = props.cells.map((c) => c.hour);
    if (!hs.length) return [];
    const out = [];
    for (let h = Math.min(...hs); h <= Math.max(...hs); h++) out.push(h);
    return out;
  }, [props.cells]);
  const order = [1, 2, 3, 4, 5, 6, 0];
  const max = Math.max(1, ...props.cells.map((c) => c.value));
  const get = (d: number, h: number) => props.cells.find((c) => c.dow === d && c.hour === h)?.value ?? 0;
  const [hover, setHover] = useState<{ d: number; h: number } | null>(null);
  return (
    <figure className="viz">
      <div className="heat" style={{ gridTemplateColumns: `40px repeat(${hours.length}, minmax(22px, 1fr))` }} role="img" aria-label={props.title}>
        <span />
        {hours.map((h) => (
          <span key={h} className="heat-h">
            {h}
          </span>
        ))}
        {order.map((d) => (
          <Row key={d}>
            <span className="heat-d">{DAYS[d]}</span>
            {hours.map((h) => {
              const v = get(d, h);
              const step = v === 0 ? -1 : Math.min(RAMP.length - 1, Math.floor((v / max) * RAMP.length));
              return (
                <span
                  key={h}
                  className={`heat-c ${hover?.d === d && hover?.h === h ? "on" : ""}`}
                  style={{ background: step < 0 ? "var(--viz-empty)" : RAMP[step] }}
                  onPointerEnter={() => setHover({ d, h })}
                  onPointerLeave={() => setHover(null)}
                  title={`${DAYS[d]} ${h}:00 · ${v} ${props.unit}`}
                />
              );
            })}
          </Row>
        ))}
      </div>
      <p className="viz-note">
        {hover ? (
          <>
            <strong>
              {DAYS[hover.d]} {hover.h}:00–{hover.h + 1}:00
            </strong>{" "}
            · {get(hover.d, hover.h)} {props.unit}
          </>
        ) : (
          <>
            Darker = busier. Busiest: {(() => {
              const top = [...props.cells].sort((a, b) => b.value - a.value)[0];
              return top ? `${DAYS[top.dow]} ${top.hour}:00 (${top.value} ${props.unit})` : "–";
            })()}
          </>
        )}
      </p>
      <DataTable
        caption={props.title}
        head={["Day", ...hours.map((h) => `${h}:00`)]}
        rows={order.map((d) => [DAYS[d]!, ...hours.map((h) => get(d, h))])}
      />
    </figure>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

export interface ScatterPoint {
  id: string;
  label: string;
  x: number;
  y: number;
  /** Shown in the tooltip. */
  detail: string;
  emphasis?: boolean;
}

/** Popularity × profit with quadrant guides; one hue, labels only on emphasised points. */
export function QuadrantScatter(props: {
  points: ScatterPoint[];
  xLine: number;
  yLine: number;
  xLabel: string;
  yLabel: string;
  formatX: (v: number) => string;
  formatY: (v: number) => string;
  quadrants: [string, string, string, string]; // top-right, top-left, bottom-right, bottom-left
  title: string;
}) {
  const width = 640;
  const height = 320;
  const pad = { l: 56, r: 16, t: 16, b: 36 };
  const id = useId();
  const [hover, setHover] = useState<ScatterPoint | null>(null);
  const xMax = Math.max(props.xLine * 2, ...props.points.map((p) => p.x)) * 1.08;
  const yVals = props.points.map((p) => p.y);
  const yMin = Math.min(0, ...yVals);
  const yMax = Math.max(props.yLine * 2, ...yVals) * 1.08;
  const x = (v: number) => pad.l + (v / xMax) * (width - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - yMin) / (yMax - yMin)) * (height - pad.t - pad.b);
  const yTicks = niceTicks(yMax).filter((t) => t <= yMax);
  // Greedy label placement: skip a label that would overlap one already placed.
  const labelled = useMemo(() => {
    const placed: { x1: number; x2: number; y: number }[] = [];
    const ok = new Set<string>();
    for (const p of [...props.points].filter((p) => p.emphasis).sort((a, b) => b.y - a.y)) {
      const px = x(p.x);
      const w = p.label.length * 6.2;
      const left = px > width * 0.72;
      const box = { x1: left ? px - 9 - w : px + 9, x2: left ? px - 9 : px + 9 + w, y: y(p.y) };
      if (placed.some((b) => Math.abs(b.y - box.y) < 14 && b.x1 < box.x2 && box.x1 < b.x2)) continue;
      placed.push(box);
      ok.add(p.id);
    }
    return ok;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.points, xMax, yMax, yMin]);
  return (
    <figure className="viz">
      <div className="viz-plot">
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={props.title}>
          <defs>
            <clipPath id={`${id}-c`}>
              <rect x={pad.l} y={pad.t} width={width - pad.l - pad.r} height={height - pad.t - pad.b} />
            </clipPath>
          </defs>
          {yTicks.map((t) => (
            <g key={t}>
              <line className="viz-grid" x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} />
              <text className="viz-axis" x={pad.l - 8} y={y(t)} textAnchor="end" dominantBaseline="middle">
                {props.formatY(t)}
              </text>
            </g>
          ))}
          <line className="viz-guide" x1={x(props.xLine)} x2={x(props.xLine)} y1={pad.t} y2={height - pad.b} />
          <line className="viz-guide" x1={pad.l} x2={width - pad.r} y1={y(props.yLine)} y2={y(props.yLine)} />
          <text className="viz-quad" x={width - pad.r - 6} y={pad.t + 14} textAnchor="end">{props.quadrants[0]}</text>
          <text className="viz-quad" x={pad.l + 6} y={pad.t + 14}>{props.quadrants[1]}</text>
          <text className="viz-quad" x={width - pad.r - 6} y={height - pad.b - 8} textAnchor="end">{props.quadrants[2]}</text>
          <text className="viz-quad" x={pad.l + 6} y={height - pad.b - 8}>{props.quadrants[3]}</text>
          <text className="viz-axis" x={(width + pad.l) / 2} y={height - 6} textAnchor="middle">
            {props.xLabel} →
          </text>
          <text className="viz-axis" x={14} y={(height - pad.b) / 2} textAnchor="middle" transform={`rotate(-90 14 ${(height - pad.b) / 2})`}>
            {props.yLabel} →
          </text>
          <g clipPath={`url(#${id}-c)`}>
            {props.points.map((p) => (
              <g key={p.id} onPointerEnter={() => setHover(p)} onPointerLeave={() => setHover(null)}>
                <circle cx={x(p.x)} cy={y(p.y)} r={12} fill="transparent" />
                <circle cx={x(p.x)} cy={y(p.y)} r={hover?.id === p.id ? 7 : 5} fill="var(--series-1)" stroke="var(--viz-surface)" strokeWidth={2} />
                {labelled.has(p.id) && (
                  // Labels near the right edge go on the left of their dot so they aren't cut off.
                  <text
                    className="viz-label small"
                    x={x(p.x) > width * 0.72 ? x(p.x) - 9 : x(p.x) + 9}
                    y={y(p.y)}
                    textAnchor={x(p.x) > width * 0.72 ? "end" : "start"}
                    dominantBaseline="middle"
                  >
                    {p.label}
                  </text>
                )}
              </g>
            ))}
          </g>
        </svg>
        {hover && (
          <div className="viz-tip" style={{ left: `${Math.min(70, (x(hover.x) / width) * 100)}%`, top: `${(y(hover.y) / height) * 100}%` }} role="status">
            <strong>{hover.label}</strong>
            <div>{hover.detail}</div>
          </div>
        )}
      </div>
    </figure>
  );
}

export function HBars(props: { rows: { label: string; value: number }[]; format: (v: number) => string; title: string }) {
  const max = Math.max(1, ...props.rows.map((r) => r.value));
  return (
    <figure className="viz hbars" aria-label={props.title}>
      {props.rows.map((r) => (
        <div key={r.label} className="hbar">
          <span className="hbar-l">{r.label}</span>
          <span className="hbar-track">
            <span className="hbar-fill" style={{ width: `${(r.value / max) * 100}%` }} />
          </span>
          <span className="hbar-v num">{props.format(r.value)}</span>
        </div>
      ))}
    </figure>
  );
}

export function StatTile(props: {
  label: string;
  value: string;
  /** Change vs previous period, as a fraction (0.12 = +12%). */
  delta?: number | null;
  /** Whether a rise is good (sales) or bad (wait times). */
  upIsGood?: boolean;
  hint?: string;
  hero?: boolean;
}) {
  const d = props.delta;
  const good = d == null || d === 0 ? null : (d > 0) === (props.upIsGood ?? true);
  return (
    <div className={`stat-tile ${props.hero ? "hero" : ""}`}>
      <span className="st-label">{props.label}</span>
      <span className="st-value num">{props.value}</span>
      {d != null && Number.isFinite(d) && (
        <span className={`st-delta ${good === null ? "" : good ? "up" : "down"}`}>
          {d > 0 ? "▲" : d < 0 ? "▼" : "■"} {Math.abs(Math.round(d * 100))}% <span className="muted">vs previous</span>
        </span>
      )}
      {props.hint && <span className="st-hint muted">{props.hint}</span>}
    </div>
  );
}
