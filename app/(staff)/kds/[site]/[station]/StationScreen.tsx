"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { allDay, sequenceTickets, type PlannedItem, type PlannedTicket } from "@/src/kitchen/sequencing";
import type { StationInfo, StationTicket } from "@/src/server/kitchen";
import { readyAction, recallAction, rushAction, serveAction, startAction } from "../../actions";

const COURSE = ["Drinks", "Starters", "Mains", "Desserts"];
const POLL_MS = 3000;

type Wire = { station: StationInfo; tickets: StationTicket[] };

/** JSON turns Dates into strings; turn them back. */
function revive(t: StationTicket): StationTicket {
  const d = (v: unknown) => (v ? new Date(v as string) : null);
  return {
    ...t,
    firedAt: new Date(t.firedAt as unknown as string),
    bumpedAt: d(t.bumpedAt),
    items: t.items.map((i) => ({ ...i, startedAt: d(i.startedAt), readyAt: d(i.readyAt) })),
  };
}

const mmss = (minutes: number) => {
  const s = Math.max(0, Math.round(minutes * 60));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

function beep() {
  try {
    const ctx = new AudioContext();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.2, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.4);
  } catch {
    // No audio (e.g. not allowed yet): the flash is enough.
  }
}

export default function StationScreen({ siteSlug, siteName, initial }: { siteSlug: string; siteName: string; initial: Wire }) {
  const [data, setData] = useState<Wire>(() => ({ ...initial, tickets: initial.tickets.map(revive) }));
  const [now, setNow] = useState(() => new Date());
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [sound, setSound] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const seen = useRef(new Set(initial.tickets.map((t) => t.id)));
  const { station } = data;
  const isPass = station.kind === "pass";

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/kds/${siteSlug}/${station.code}`, { cache: "no-store" });
      if (r.status === 401) return setError("Signed out. Sign in again to keep receiving tickets.");
      if (!r.ok) throw new Error(String(r.status));
      const body = (await r.json()) as Wire;
      const tickets = body.tickets.map(revive);
      const arrived = tickets.filter((t) => !t.bumpedAt && !seen.current.has(t.id)).map((t) => t.id);
      for (const id of arrived) seen.current.add(id);
      if (arrived.length) {
        if (sound) beep();
        setFresh(new Set(arrived));
        setTimeout(() => setFresh(new Set()), 4000);
      }
      setData({ station: body.station, tickets });
      setOffline(false);
    } catch {
      setOffline(true);
    }
  }, [siteSlug, station.code, sound]);

  useEffect(() => {
    const poll = setInterval(load, POLL_MS);
    const clock = setInterval(() => setNow(new Date()), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(clock);
    };
  }, [load]);

  const act = async (key: string, fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setBusy(key);
    setError(null);
    const r = await fn();
    setBusy(null);
    if (!r.ok) setError(r.error ?? "Didn't work, try again");
    await load();
  };

  // The pass works on tickets the kitchen has bumped: everything not yet served.
  const live = isPass ? data.tickets.map((t) => ({ ...t, bumpedAt: null })) : data.tickets.filter((t) => !t.bumpedAt);
  const planned = useMemo(() => {
    const seq = sequenceTickets(live, now);
    if (!isPass) return seq;
    // Plates sitting on the pass go first (longest waiting), then what's closest to ready.
    const waitingSince = (t: PlannedTicket) =>
      Math.min(...t.items.filter((i) => i.status === "ready").map((i) => (i.readyAt ?? now).getTime()), Infinity);
    return [...seq].sort((a, b) => {
      const ar = a.items.some((i) => i.status === "ready");
      const br = b.items.some((i) => i.status === "ready");
      if (ar !== br) return ar ? -1 : 1;
      if (ar) return waitingSince(a) - waitingSince(b);
      return a.expectedReady.getTime() - b.expectedReady.getTime();
    });
  }, [live, now, isPass]);
  const counts = useMemo(() => allDay(live), [live]);
  const recent = data.tickets
    .filter((t) => t.bumpedAt)
    .sort((a, b) => b.bumpedAt!.getTime() - a.bumpedAt!.getTime())
    .slice(0, 6);
  const extra = new Map(data.tickets.map((t) => [t.id, t]));
  const late = planned.filter((t) => t.urgency === "late").length;

  return (
    <main className={`kds ${isPass ? "kds-pass" : ""}`}>
      <header className="kds-head">
        <h1>
          {station.name} <span className="muted">· {siteName}</span>
        </h1>
        <div className="kds-stats">
          <span>
            <strong>{planned.length}</strong> open
          </span>
          {late > 0 && (
            <span className="late-count">
              <strong>{late}</strong> late
            </span>
          )}
          <span className="clock num">{now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" })}</span>
          {offline && <span className="offline">Reconnecting…</span>}
          <button type="button" onClick={() => setSound((s) => !s)} aria-pressed={sound}>
            {sound ? "🔔 Sound on" : "🔕 Sound off"}
          </button>
          <button type="button" onClick={() => document.documentElement.requestFullscreen?.()}>
            Full screen
          </button>
        </div>
      </header>
      {error && (
        <p className="kds-error" role="alert">
          {error}
        </p>
      )}

      <div className="kds-body">
        <section className="kds-rail" aria-label="Tickets">
          {planned.length === 0 && <p className="kds-empty">All clear. New tickets appear here.</p>}
          {planned.map((t) =>
            isPass ? (
              <PassTicket
                key={t.id}
                t={t}
                info={extra.get(t.id)!}
                busy={busy}
                fresh={fresh.has(t.id)}
                onServe={() => act(t.id, () => serveAction(siteSlug, t.id, "all"))}
                onRush={() => act(t.id, () => rushAction(siteSlug, t.id, !t.priority))}
              />
            ) : (
              <Ticket
                key={t.id}
                t={t}
                info={extra.get(t.id)!}
                bar={station.kind === "bar"}
                busy={busy}
                fresh={fresh.has(t.id)}
                onItem={(i) =>
                  act(i.id, () =>
                    i.status === "sent" && station.kind !== "bar"
                      ? startAction(siteSlug, t.id, [i.id])
                      : readyAction(siteSlug, t.id, [i.id]),
                  )
                }
                onStartAll={() => act(t.id, () => startAction(siteSlug, t.id, "all"))}
                onBump={() => act(t.id, () => readyAction(siteSlug, t.id, "all"))}
              />
            ),
          )}
        </section>

        {!isPass && (
          <aside className="kds-side">
            <h2>All day</h2>
            {counts.length === 0 ? (
              <p className="muted">Nothing waiting.</p>
            ) : (
              <ul className="allday">
                {counts.map((c) => (
                  <li key={c.name}>
                    <span className="num big">{c.waiting + c.cooking}</span>
                    <span className="nm">{c.name}</span>
                    {c.cooking > 0 && <span className="muted small">{c.cooking} on</span>}
                  </li>
                ))}
              </ul>
            )}
            {recent.length > 0 && (
              <>
                <h2>Just sent out</h2>
                <ul className="recent">
                  {recent.map((t) => (
                    <li key={t.id}>
                      <span>
                        {t.tableLabel} · #{t.number}
                      </span>
                      <button type="button" disabled={busy === t.id} onClick={() => act(t.id, () => recallAction(siteSlug, t.id))}>
                        Recall
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </aside>
        )}
      </div>
    </main>
  );
}

function itemLabel(i: PlannedItem, bar: boolean): { text: string; cls: string } {
  if (i.status === "ready" || i.status === "served") return { text: "Ready", cls: "done" };
  if (i.status === "started") return { text: bar ? "Making" : "Cooking", cls: "cooking" };
  if (bar) return { text: "Make", cls: "now" };
  if (i.startInMinutes !== null && i.startInMinutes > 0) return { text: `Start in ${i.startInMinutes}m`, cls: "wait" };
  return { text: "Start now", cls: "now" };
}

function Ticket(props: {
  t: PlannedTicket;
  info: StationTicket;
  bar: boolean;
  busy: string | null;
  fresh: boolean;
  onItem: (i: PlannedItem) => void;
  onStartAll: () => void;
  onBump: () => void;
}) {
  const { t, info, bar } = props;
  const remaining = (t.target.getTime() - Date.now()) / 60_000;
  return (
    <article className={`ticket u-${t.urgency} ${t.priority ? "rush" : ""} ${props.fresh ? "fresh" : ""}`}>
      <header>
        <div>
          <strong className="tbl-label">{t.tableLabel}</strong>
          <span className="muted">
            {" "}
            #{t.number} · {COURSE[t.course] ?? `Course ${t.course}`}
            {info.covers ? ` · ${info.covers} cvr` : ""}
          </span>
        </div>
        <div className="timer num" title="Time since fired / target">
          {mmss(t.elapsedMinutes)}
          <small>{t.done ? "" : remaining >= 0 ? `due in ${Math.ceil(remaining)}m` : `${Math.ceil(-remaining)}m over`}</small>
        </div>
      </header>
      {t.priority && <div className="rush-tag">RUSH</div>}
      {info.allergyNote && <div className="allergy">⚠ {info.allergyNote}</div>}
      <ul>
        {t.items.map((i) => {
          const l = itemLabel(i, bar);
          return (
            <li key={i.id}>
              <button type="button" className={`kitem ${l.cls}`} disabled={props.busy === i.id || l.cls === "done"} onClick={() => props.onItem(i)}>
                <span className="q num">{i.quantity}</span>
                <span className="n">
                  {i.name}
                  {i.seat ? <small> · S{i.seat}</small> : null}
                  {i.detail && <span className="d">{i.detail}</span>}
                </span>
                <span className="s">{l.text}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {info.upcoming.length > 0 && (
        <p className="upcoming">
          Then: {info.upcoming.map((u) => `${u.quantity}× ${u.name}`).join(", ")} <span className="muted">(on hold)</span>
        </p>
      )}
      <footer>
        {!bar && t.items.some((i) => i.status === "sent") && (
          <button type="button" disabled={props.busy === t.id} onClick={props.onStartAll}>
            Start all
          </button>
        )}
        <button type="button" className="bump" disabled={props.busy === t.id} onClick={props.onBump}>
          {bar ? "Done" : "Ready · bump"}
        </button>
      </footer>
    </article>
  );
}

function PassTicket(props: {
  t: PlannedTicket;
  info: StationTicket;
  busy: string | null;
  fresh: boolean;
  onServe: () => void;
  onRush: () => void;
}) {
  const { t, info } = props;
  const ready = t.items.filter((i) => i.status === "ready").length;
  const waiting = t.items.filter((i) => i.status !== "ready" && i.status !== "served");
  return (
    <article className={`ticket u-${t.urgency} ${t.priority ? "rush" : ""} ${ready && !waiting.length ? "all-ready" : ""} ${props.fresh ? "fresh" : ""}`}>
      <header>
        <div>
          <strong className="tbl-label">{t.tableLabel}</strong>
          <span className="muted">
            {" "}
            #{t.number} · {COURSE[t.course] ?? `Course ${t.course}`}
          </span>
        </div>
        <div className="timer num">{mmss(t.elapsedMinutes)}</div>
      </header>
      {info.allergyNote && <div className="allergy">⚠ {info.allergyNote}</div>}
      <ul>
        {t.items.filter((i) => i.status !== "served").map((i) => (
          <li key={i.id} className={`pitem ${i.status}`}>
            <span className="q num">{i.quantity}</span>
            <span className="n">
              {i.name}
              {i.seat ? <small> · S{i.seat}</small> : null}
              {i.detail && <span className="d">{i.detail}</span>}
            </span>
            <span className="s">
              {i.status === "ready"
                ? "On the pass"
                : i.status === "started"
                  ? `Cooking · ~${Math.max(0, Math.round((i.expectedReady.getTime() - Date.now()) / 60_000))}m`
                  : "Not started"}
            </span>
          </li>
        ))}
      </ul>
      <footer>
        <button type="button" onClick={props.onRush} disabled={props.busy === t.id}>
          {t.priority ? "Un-rush" : "Rush"}
        </button>
        <button type="button" className="bump" disabled={!ready || props.busy === t.id} onClick={props.onServe}>
          {waiting.length && ready ? `Send ${ready} now` : "Served"}
        </button>
      </footer>
    </article>
  );
}
