"use client";

// Charts for the Growth views, in the dashboard's visual language (.viz classes).

import { useRef, useState } from "react";
import { fmt, type Fmt } from "@/src/growth/engine";
import { DataTable, QuadrantScatter } from "@/src/ui/charts";

function ticksFor(lo: number, hi: number, count = 4): number[] {
  const span = hi - lo || Math.abs(hi) || 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.floor(lo / step) * step; v <= hi + step * 0.999; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

/**
 * One measure by week. `zero` anchors the axis at zero (totals); without it
 * the axis fits the data (ratios and times, where the movement is the story).
 */
export function Trend(props: { title: string; labels: string[]; values: (number | null)[]; fmt: Fmt; zero?: boolean; color?: string; scale?: number; compact?: boolean }) {
  const { labels } = props;
  const k = props.scale ?? 1;
  const values = props.values.map((v) => (v == null ? null : v * k));
  const show = (v: number) => fmt(props.fmt, v / k);
  const color = props.color ?? "var(--series-1)";
  const width = props.compact ? 420 : 640;
  const height = props.compact ? 190 : 220;
  const pad = { l: 52, r: 58, t: 12, b: 28 };
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const nums = values.filter((v): v is number => v != null);
  if (!nums.length) return <p className="viz-note">Nothing to chart in this data.</p>;
  const ticks = ticksFor(props.zero ? 0 : Math.min(...nums), Math.max(...nums));
  const lo = ticks[0]!;
  const hi = ticks[ticks.length - 1]!;
  const x = (i: number) => pad.l + (labels.length <= 1 ? 0.5 : i / (labels.length - 1)) * (width - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - lo) / (hi - lo || 1)) * (height - pad.t - pad.b);
  const every = Math.max(1, Math.ceil(labels.length / (props.compact ? 5 : 7)));
  const segs: string[] = [];
  let cur: string[] = [];
  values.forEach((v, i) => {
    if (v != null) cur.push(`${x(i)},${y(v)}`);
    else if (cur.length) {
      segs.push(cur.join(" "));
      cur = [];
    }
  });
  if (cur.length) segs.push(cur.join(" "));
  const last = values.reduce<number>((a, v, i) => (v != null ? i : a), -1);
  const onMove = (e: React.PointerEvent) => {
    const box = ref.current!.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * width;
    setHover(Math.max(0, Math.min(labels.length - 1, Math.round(((px - pad.l) / (width - pad.l - pad.r)) * (labels.length - 1)))));
  };
  const tipLeft = hover == null ? 0 : (x(hover) / width) * 100;
  return (
    <figure className="viz">
      <div className="viz-plot">
        <svg ref={ref} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={props.title} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line className="viz-grid" x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} />
              <text className="viz-axis" x={pad.l - 8} y={y(t)} textAnchor="end" dominantBaseline="middle">
                {show(t)}
              </text>
            </g>
          ))}
          {labels.map((l, i) => (i % every === 0 ? <text key={i} className="viz-axis" x={x(i)} y={height - 8} textAnchor="middle">{l}</text> : null))}
          {segs.map((s, i) => (
            <polyline key={i} points={s} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          ))}
          {last >= 0 && (
            <>
              <circle cx={x(last)} cy={y(values[last]!)} r={4} fill={color} stroke="var(--viz-surface)" strokeWidth={2} />
              <text className="viz-label" x={x(last) + 8} y={y(values[last]!)} dominantBaseline="middle">
                {show(values[last]!)}
              </text>
            </>
          )}
          {hover != null && values[hover] != null && (
            <g>
              <line className="viz-cross" x1={x(hover)} x2={x(hover)} y1={pad.t} y2={height - pad.b} />
              <circle cx={x(hover)} cy={y(values[hover]!)} r={5} fill={color} stroke="var(--viz-surface)" strokeWidth={2} />
            </g>
          )}
        </svg>
        {hover != null && (
          <div className="viz-tip" style={tipLeft > 60 ? { right: `${100 - tipLeft + 2}%`, top: 0 } : { left: `${tipLeft + 2}%`, top: 0 }} role="status">
            <strong>Week of {labels[hover]}</strong>
            <div className="viz-tip-row">
              {props.title} <b>{values[hover] == null ? "No data" : show(values[hover]!)}</b>
            </div>
          </div>
        )}
      </div>
      <DataTable caption={props.title} head={["Week of", props.title]} rows={labels.map((l, i) => [l, values[i] == null ? "No data" : show(values[i]!)])} />
    </figure>
  );
}

export function MenuScatter(props: { points: { item: string; qty: number; margin: number; cls: string }[]; thr: number; avgMargin: number; group: string }) {
  const top = [...props.points].sort((a, b) => b.qty * b.margin - a.qty * a.margin).slice(0, 8).map((p) => p.item);
  return (
    <QuadrantScatter
      title={`Popularity against margin per sale, ${props.group}`}
      points={props.points.map((p) => ({ id: p.item, label: p.item, x: p.qty, y: p.margin, detail: `${fmt("int", p.qty)} sold, ${fmt("money2", p.margin)} margin per sale. ${p.cls}.`, emphasis: top.includes(p.item) || p.cls === "Puzzle" }))}
      xLine={props.thr}
      yLine={props.avgMargin}
      xLabel="Number sold"
      yLabel="Margin per sale"
      formatX={(v) => fmt("int", v)}
      formatY={(v) => fmt(v % 1 ? "money2" : "money0", v)}
      quadrants={["Stars", "Puzzles", "Plough horses", "Dogs"]}
    />
  );
}
