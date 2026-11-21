"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { BRIDGE_FIELDS, bridge, moneyK, type BridgeInput } from "@/src/growth/engine";
import { saveBridgeAction } from "./actions";

function Waterfall({ b }: { b: ReturnType<typeof bridge> }) {
  const width = 720;
  const height = 300;
  const pad = { l: 56, r: 12, t: 16, b: 44 };
  const bars = [...b.steps.map((s, i) => ({ label: s.label, lo: i ? s.running - s.adds : 0, hi: s.running, total: i === 0 })), { label: "Plan", lo: 0, hi: b.total, total: true }];
  const top = Math.max(b.total, b.targetLine) * 1.08 || 1;
  const mag = 10 ** Math.floor(Math.log10(top / 4));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((x) => x >= top / 4) ?? top / 4;
  const max = Math.ceil(top / step) * step;
  const y = (v: number) => pad.t + (1 - v / max) * (height - pad.t - pad.b);
  const slot = (width - pad.l - pad.r) / bars.length;
  const ticks = Array.from({ length: Math.round(max / step) + 1 }, (_, i) => i * step);
  return (
    <figure className="viz">
      <figcaption className="viz-legend">
        <span><i style={{ background: "var(--text)" }} /> Today and plan</span>
        <span><i style={{ background: "var(--series-1)" }} /> What each move adds</span>
        <span><i style={{ background: "var(--series-2)" }} /> Target line</span>
      </figcaption>
      <svg className="gwater" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Bridge from today's sales to the plan">
        {ticks.map((t) => (
          <g key={t}>
            <line className="viz-grid" x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} />
            <text className="viz-axis" x={pad.l - 8} y={y(t)} textAnchor="end" dominantBaseline="middle">{t ? moneyK(t) : "£0"}</text>
          </g>
        ))}
        {bars.map((bar, i) => {
          const x = pad.l + i * slot + slot * 0.16;
          const w = slot * 0.68;
          return (
            <g key={bar.label}>
              <rect x={x} y={y(bar.hi)} width={w} height={Math.max(1, y(bar.lo) - y(bar.hi))} rx={3} fill={bar.total ? "var(--text)" : "var(--series-1)"} />
              <text className="viz-label small" x={x + w / 2} y={y(bar.hi) - 6} textAnchor="middle">{bar.total ? moneyK(bar.hi) : `+${moneyK(bar.hi - bar.lo)}`}</text>
              {bar.label.split(" ").reduce<string[]>((lines, word) => {
                const last = lines[lines.length - 1];
                if (last && (last + " " + word).length <= 11) lines[lines.length - 1] = last + " " + word;
                else lines.push(word);
                return lines;
              }, []).map((line, k) => (
                <text key={k} className="viz-axis" x={x + w / 2} y={height - pad.b + 16 + k * 13} textAnchor="middle">{line}</text>
              ))}
            </g>
          );
        })}
        <line x1={pad.l} x2={width - pad.r} y1={y(b.targetLine)} y2={y(b.targetLine)} stroke="var(--series-2)" strokeWidth={2} strokeDasharray="6 4" />
      </svg>
    </figure>
  );
}

export default function BridgeEditor(props: { slug: string; initial: BridgeInput; defaults: BridgeInput; saved: boolean; baseNote: string }) {
  const router = useRouter();
  const [v, setV] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(props.initial).map(([k, n]) => [k, String(n)])));
  const [state, setState] = useState<"" | "saving" | "saved" | string>("");
  const [, start] = useTransition();
  const input = Object.fromEntries(Object.keys(props.defaults).map((k) => [k, Math.max(0, parseFloat(v[k] ?? "") || 0)])) as unknown as BridgeInput;
  const b = bridge(input);
  const target = input.target || 3;

  const save = (next: BridgeInput | null) => {
    setState("saving");
    start(async () => {
      const r = await saveBridgeAction(props.slug, next);
      setState(r.ok ? "saved" : r.error);
      if (r.ok && next === null) router.refresh();
    });
  };
  const field = (key: string, label: string, step?: number) => (
    <label key={key}>
      {label}
      <input type="number" min={0} step={step ?? "any"} inputMode="decimal" value={v[key] ?? ""} onChange={(e) => setV({ ...v, [key]: e.target.value })} onBlur={() => save(input)} />
    </label>
  );

  return (
    <>
      <div className="gtiles">
        <div className="stat-tile"><span className="st-label">Where the plan lands</span><span className="st-value num">{moneyK(b.total)}</span></div>
        <div className="stat-tile">
          <span className="st-label">Multiple of today</span>
          <span className="st-value num">{b.multiple == null ? "No data" : `${b.multiple.toFixed(2)}x`}</span>
          <span className={`chip ${b.gap <= 0 ? "good" : (b.multiple ?? 0) >= target * 0.83 ? "warn" : "bad"}`} style={{ alignSelf: "flex-start" }}>{b.gap <= 0 ? `Reaches ${target}x` : `Short of ${target}x`}</span>
        </div>
        <div className="stat-tile"><span className="st-label">{b.gap > 0 ? "Still to find" : `Above the ${target}x line by`}</span><span className="st-value num">{moneyK(Math.abs(b.gap))}</span></div>
      </div>
      <section className="box">
        <h2>Bridge from today to the plan</h2>
        <Waterfall b={b} />
      </section>
      <div className="gcols">
        <section className="box">
          <h2>Assumptions</h2>
          <div className="gform">
            {field("base", "Annual net sales today, £", 1000)}
            {field("target", "Target multiple", 0.1)}
            {BRIDGE_FIELDS.map(([k, label]) => field(k, label))}
          </div>
          <p className="gnote">{props.baseNote} Changes save as you leave each box. {state === "saving" ? "Saving." : state === "saved" ? "Saved." : state ? <span className="error">{state}</span> : ""}</p>
          <div className="btn-row" style={{ marginTop: 10 }}>
            <button type="button" className="ghost" onClick={() => { setV(Object.fromEntries(Object.entries(props.defaults).map(([k, n]) => [k, String(n)]))); save(null); }}>
              Reset assumptions
            </button>
          </div>
        </section>
        <section className="box">
          <h2>Step by step</h2>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Step</th><th className="right">Adds</th><th className="right">Running total</th><th className="right">Multiple</th></tr></thead>
              <tbody>
                {b.steps.map((s, i) => (
                  <tr key={s.label}>
                    <td>{s.label}</td>
                    <td className="right num">{i ? `+${moneyK(s.adds)}` : ""}</td>
                    <td className="right num">{moneyK(s.running)}</td>
                    <td className="right num">{input.base ? `${(s.running / input.base).toFixed(2)}x` : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </>
  );
}
