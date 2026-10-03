"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import type { Diary, DiaryBooking, DiaryTable } from "@/src/server/diary";
import { formatTime } from "@/src/lib/api";
import {
  ACTION_LABEL,
  HOLDS_TABLE,
  STATUS_LABEL,
  allowedTransitions,
  type DiaryStatus,
} from "@/src/lib/diary-shared";
import { signOut, updateStatus } from "../actions";

const PX_PER_MIN = 1.6;
const REFRESH_MS = 30_000;
const SOON_MINUTES = 60;
const REGULAR_VISITS = 3;

type View = "timeline" | "floor";

function addDays(date: string, days: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const dayTitle = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });

const end = (b: DiaryBooking) => b.start + b.durationMinutes;
const covering = (b: DiaryBooking, t: number) => b.start <= t && t < end(b);

export default function DiaryView({
  diary,
  sites,
  today,
  nowMinutes,
}: {
  diary: Diary;
  sites: { slug: string; name: string }[];
  today: string;
  nowMinutes: number | null;
}) {
  const router = useRouter();
  const [view, setView] = useState<View>("timeline");
  const [showCancelled, setShowCancelled] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { date, site } = diary;

  // Keep the diary fresh: online bookings land while the host is looking at it.
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, REFRESH_MS);
    return () => clearInterval(id);
  }, [router]);

  const axis = useMemo(() => {
    const starts = diary.services.map((s) => s.firstSeating);
    const ends = diary.services.map((s) => s.endsBy);
    const from = Math.floor((starts.length ? Math.min(...starts) : 12 * 60) / 60) * 60;
    const to = Math.ceil((ends.length ? Math.max(...ends) : 23 * 60) / 60) * 60;
    return { from, to };
  }, [diary.services]);

  const visible = diary.bookings.filter(
    (b) => showCancelled || (b.status !== "cancelled" && b.status !== "no_show"),
  );
  const selected = diary.bookings.find((b) => b.id === selectedId) ?? null;
  const tableLabel = useMemo(() => new Map(diary.tables.map((t) => [t.id, t.label])), [diary.tables]);

  const go = (params: { site?: string; date?: string }) =>
    `/diary/${params.site ?? site.slug}${(params.date ?? date) === today ? "" : `?date=${params.date ?? date}`}`;

  return (
    <div className="diary">
      <header className="dhead">
        <nav className="dsites" aria-label="Site">
          {sites.map((s) => (
            <Link key={s.slug} href={go({ site: s.slug })} className={s.slug === site.slug ? "on" : ""}>
              {s.name}
            </Link>
          ))}
        </nav>
        <div className="ddate">
          <Link href={go({ date: addDays(date, -1) })} aria-label="Previous day" className="dbtn">
            ‹
          </Link>
          <h1>{date === today ? `Today · ${dayTitle(date)}` : dayTitle(date)}</h1>
          <Link href={go({ date: addDays(date, 1) })} aria-label="Next day" className="dbtn">
            ›
          </Link>
          {date !== today && (
            <Link href={go({ date: today })} className="dbtn">
              Today
            </Link>
          )}
          <input
            type="date"
            value={date}
            aria-label="Go to date"
            onChange={(e) => e.target.value && router.push(go({ date: e.target.value }))}
          />
        </div>
        <div className="dtools">
          <div className="seg" role="tablist" aria-label="View">
            <button role="tab" aria-selected={view === "timeline"} onClick={() => setView("timeline")}>
              Timeline
            </button>
            <button role="tab" aria-selected={view === "floor"} onClick={() => setView("floor")}>
              Floor
            </button>
          </div>
          <label className="dcheck">
            <input type="checkbox" checked={showCancelled} onChange={(e) => setShowCancelled(e.target.checked)} />
            Show cancelled &amp; no-shows
          </label>
          <form action={signOut}>
            <button type="submit" className="dbtn">
              Sign out
            </button>
          </form>
        </div>
      </header>

      <Summary diary={diary} />

      {diary.services.length === 0 && diary.bookings.length === 0 ? (
        <p className="dempty">Closed on {dayTitle(date)}: no services run and nothing is booked.</p>
      ) : view === "timeline" ? (
        <Timeline
          diary={diary}
          bookings={visible}
          axis={axis}
          nowMinutes={nowMinutes}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
      ) : (
        <Floor
          diary={diary}
          bookings={visible}
          axis={axis}
          nowMinutes={nowMinutes}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
      )}

      {selected && (
        <BookingPanel
          key={selected.id}
          booking={selected}
          siteSlug={site.slug}
          tables={selected.tableIds.map((id) => tableLabel.get(id) ?? "?")}
          serviceName={diary.services.find((s) => s.id === selected.serviceId)?.name ?? ""}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}

function Summary({ diary }: { diary: Diary }) {
  const live = diary.bookings.filter((b) => b.status !== "cancelled");
  const rows = diary.services.map((s) => {
    const inService = live.filter((b) => b.serviceId === s.id);
    const covers = (list: DiaryBooking[]) => list.reduce((n, b) => n + b.covers, 0);
    return {
      id: s.id,
      name: s.name,
      bookings: inService.filter((b) => b.status !== "no_show").length,
      covers: covers(inService.filter((b) => b.status !== "no_show")),
      seated: covers(inService.filter((b) => b.status === "seated")),
      done: covers(inService.filter((b) => b.status === "completed")),
      noShows: inService.filter((b) => b.status === "no_show").length,
    };
  });
  const seats = diary.tables.reduce((n, t) => n + t.maxCovers, 0);
  return (
    <section className="dsummary" aria-label="Day summary">
      {rows.map((r) => (
        <div key={r.id} className="stat">
          <h2>{r.name}</h2>
          <p className="big">
            {r.covers} <span>covers</span>
          </p>
          <p className="small">
            {r.bookings} {r.bookings === 1 ? "booking" : "bookings"}
            {r.seated > 0 && ` · ${r.seated} in`}
            {r.done > 0 && ` · ${r.done} done`}
            {r.noShows > 0 && ` · ${r.noShows} no-show`}
          </p>
        </div>
      ))}
      <div className="stat">
        <h2>Room</h2>
        <p className="big">
          {diary.tables.length} <span>tables</span>
        </p>
        <p className="small">{seats} seats</p>
      </div>
    </section>
  );
}

function bookingBadges(b: DiaryBooking) {
  return (
    <>
      {b.visits >= REGULAR_VISITS && (
        <span className="badge regular" title={`${b.visits} previous visits`}>
          ★
        </span>
      )}
      {b.noShows > 0 && (
        <span className="badge warn" title={`${b.noShows} previous no-show${b.noShows > 1 ? "s" : ""}`}>
          !
        </span>
      )}
      {b.specialRequests && (
        <span className="badge note" title={b.specialRequests}>
          ✎
        </span>
      )}
    </>
  );
}

function Timeline(props: {
  diary: Diary;
  bookings: DiaryBooking[];
  axis: { from: number; to: number };
  nowMinutes: number | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const { diary, bookings, axis, nowMinutes } = props;
  const width = (axis.to - axis.from) * PX_PER_MIN;
  const x = (m: number) => (m - axis.from) * PX_PER_MIN;
  const hours: number[] = [];
  for (let h = axis.from; h <= axis.to; h += 60) hours.push(h);

  // Covers arriving per 15 minutes, to see the kitchen's pressure points.
  const arrivals = useMemo(() => {
    const buckets = new Map<number, number>();
    for (const b of bookings) {
      if (b.status === "cancelled" || b.status === "no_show") continue;
      const k = Math.floor(b.start / 15) * 15;
      buckets.set(k, (buckets.get(k) ?? 0) + b.covers);
    }
    return buckets;
  }, [bookings]);
  const maxArrivals = Math.max(1, ...arrivals.values());

  const areas = useMemo(() => {
    const groups: { id: string; name: string; tables: DiaryTable[] }[] = [];
    for (const t of diary.tables) {
      const g = groups.find((a) => a.id === t.areaId);
      if (g) g.tables.push(t);
      else groups.push({ id: t.areaId, name: t.areaName, tables: [t] });
    }
    return groups;
  }, [diary.tables]);

  const unassigned = bookings.filter((b) => b.tableIds.length === 0);

  return (
    <section className="timeline" aria-label="Timeline">
      <div className="tl-scroll">
        <div className="tl-grid" style={{ width: width + 120 }}>
          <div className="tl-row tl-axis">
            <div className="tl-label" />
            <div className="tl-track" style={{ width }}>
              {hours.map((h) => (
                <span key={h} className="tl-hour" style={{ left: x(h) }}>
                  {formatTime(h)}
                </span>
              ))}
            </div>
          </div>
          <div className="tl-row tl-arrivals" title="Covers arriving per 15 minutes">
            <div className="tl-label">Arrivals</div>
            <div className="tl-track" style={{ width }}>
              {[...arrivals].map(([t, n]) => (
                <span
                  key={t}
                  className="tl-bar"
                  style={{ left: x(t) + 1, width: 15 * PX_PER_MIN - 2, height: `${(n / maxArrivals) * 100}%` }}
                >
                  <em>{n}</em>
                </span>
              ))}
            </div>
          </div>

          {areas.map((area) => (
            <div key={area.id} className="tl-area">
              {areas.length > 1 && <div className="tl-areaname">{area.name}</div>}
              {area.tables.map((t) => (
                <div key={t.id} className="tl-row">
                  <div className="tl-label">
                    <strong>{t.label}</strong>
                    <span>
                      {t.minCovers === t.maxCovers ? t.maxCovers : `${t.minCovers}–${t.maxCovers}`}
                      {!t.bookableOnline && " · staff only"}
                    </span>
                  </div>
                  <div className="tl-track" style={{ width }}>
                    {hours.map((h) => (
                      <span key={h} className="tl-line" style={{ left: x(h) }} />
                    ))}
                    {diary.blocks
                      .filter((bl) => bl.tableId === t.id)
                      .map((bl, i) => (
                        <span
                          key={i}
                          className="tl-block"
                          style={{ left: x(Math.max(bl.start, axis.from)), width: (Math.min(bl.end, axis.to) - Math.max(bl.start, axis.from)) * PX_PER_MIN }}
                          title={bl.reason ?? "Blocked"}
                        >
                          {bl.reason ?? "Blocked"}
                        </span>
                      ))}
                    {bookings
                      .filter((b) => b.tableIds.includes(t.id))
                      .map((b) => (
                        <button
                          key={b.id}
                          type="button"
                          className={`tl-booking s-${b.status} ${props.selectedId === b.id ? "sel" : ""}`}
                          style={{ left: x(b.start), width: b.durationMinutes * PX_PER_MIN }}
                          onClick={() => props.onSelect(b.id)}
                          aria-label={`${b.guestName}, ${b.covers} at ${formatTime(b.start)}, ${STATUS_LABEL[b.status]}`}
                        >
                          <span className="nm">
                            {b.guestName} {bookingBadges(b)}
                          </span>
                          <span className="meta">
                            {b.covers} · {formatTime(b.start)}
                            {b.tableIds.length > 1 && " · joined"}
                          </span>
                          {b.status === "seated" && nowMinutes !== null && nowMinutes > end(b) && (
                            <span
                              className="over"
                              style={{ width: (nowMinutes - end(b)) * PX_PER_MIN }}
                              title={`Running ${nowMinutes - end(b)} min over`}
                              aria-hidden
                            />
                          )}
                          {b.bufferMinutes > 0 && HOLDS_TABLE.includes(b.status) && !(b.status === "seated" && nowMinutes !== null && nowMinutes > end(b)) && (
                            <span className="buf" style={{ width: b.bufferMinutes * PX_PER_MIN }} aria-hidden />
                          )}
                        </button>
                      ))}
                  </div>
                </div>
              ))}
            </div>
          ))}

          {nowMinutes !== null && nowMinutes >= axis.from && nowMinutes <= axis.to && (
            <span className="tl-now" style={{ left: 120 + x(nowMinutes) }} aria-label={`Now, ${formatTime(nowMinutes)}`} />
          )}
        </div>
      </div>
      {unassigned.length > 0 && (
        <p className="dempty">
          {unassigned.length} booking{unassigned.length > 1 ? "s have" : " has"} no table:{" "}
          {unassigned.map((b) => (
            <button key={b.id} type="button" className="link" onClick={() => props.onSelect(b.id)}>
              {b.guestName} ({formatTime(b.start)})
            </button>
          ))}
        </p>
      )}
      <Legend />
    </section>
  );
}

function Legend() {
  return (
    <p className="legend">
      <span className="sw s-confirmed" /> Booked <span className="sw s-pending" /> Pending <span className="sw s-seated" /> Seated{" "}
      <span className="sw s-completed" /> Finished <span className="sw over-sw" /> Running over <span className="sw buf-sw" /> Reset time <span className="badge regular">★</span> Regular{" "}
      <span className="badge warn">!</span> Past no-show <span className="badge note">✎</span> Notes
    </p>
  );
}

type TableState =
  | { kind: "blocked"; reason: string }
  | { kind: "seated" | "due" | "late"; booking: DiaryBooking }
  | { kind: "over"; booking: DiaryBooking; next?: DiaryBooking }
  | { kind: "soon"; booking: DiaryBooking }
  | { kind: "free"; next?: DiaryBooking };

function tableStateAt(table: DiaryTable, diary: Diary, bookings: DiaryBooking[], t: number): TableState {
  const block = diary.blocks.find((bl) => bl.tableId === table.id && bl.start <= t && t < bl.end);
  if (block) return { kind: "blocked", reason: block.reason ?? "Blocked" };
  const mine = bookings
    .filter((b) => b.tableIds.includes(table.id) && HOLDS_TABLE.includes(b.status))
    .sort((a, b) => a.start - b.start);
  // Seated guests hold the table until a host finishes it, even past their booked time.
  const overrunning = mine.find((b) => b.status === "seated" && b.start <= t && t >= end(b));
  if (overrunning && !mine.some((b) => b !== overrunning && b.status === "seated" && covering(b, t))) {
    return { kind: "over", booking: overrunning, next: mine.find((b) => b.start > end(overrunning) && b.status !== "seated") };
  }
  const now = mine.find((b) => covering(b, t));
  if (now) {
    if (now.status === "seated") return { kind: "seated", booking: now };
    // Booked, not yet seated: overdue after 15 minutes.
    return { kind: t - now.start > 15 ? "late" : "due", booking: now };
  }
  const next = mine.find((b) => b.start > t);
  if (next && next.start - t <= SOON_MINUTES) return { kind: "soon", booking: next };
  return { kind: "free", next };
}

function Floor(props: {
  diary: Diary;
  bookings: DiaryBooking[];
  axis: { from: number; to: number };
  nowMinutes: number | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const { diary, bookings, axis } = props;
  const initial =
    props.nowMinutes !== null && props.nowMinutes >= axis.from && props.nowMinutes <= axis.to
      ? props.nowMinutes
      : (diary.services.at(-1)?.firstSeating ?? axis.from) + 120;
  const [t, setT] = useState(Math.round(initial / 15) * 15);

  // Tables without a saved position are laid out in a grid per area.
  const placed = useMemo(() => {
    const byArea = new Map<string, DiaryTable[]>();
    for (const tb of diary.tables) byArea.set(tb.areaId, [...(byArea.get(tb.areaId) ?? []), tb]);
    const out: { table: DiaryTable; x: number; y: number }[] = [];
    let yOffset = 0;
    for (const tables of byArea.values()) {
      const cols = 4;
      tables.forEach((tb, i) => {
        out.push({
          table: tb,
          x: tb.posX ?? (i % cols) * 25 + 12.5,
          y: tb.posY ?? yOffset + Math.floor(i / cols) * 150 + 75,
        });
      });
      yOffset += Math.ceil(tables.length / cols) * 150 + 40;
    }
    return out;
  }, [diary.tables]);
  const height = Math.max(300, ...placed.map((p) => p.y + 90));

  const counts = { free: 0, seated: 0, booked: 0 };
  const states = new Map(placed.map((p) => [p.table.id, tableStateAt(p.table, diary, bookings, t)]));
  for (const s of states.values()) {
    if (s.kind === "seated" || s.kind === "over") counts.seated++;
    else if (s.kind === "due" || s.kind === "late") counts.booked++;
    else if (s.kind !== "blocked") counts.free++;
  }

  return (
    <section className="floor" aria-label="Floor plan">
      <div className="fl-controls">
        <label>
          <span>
            At <strong>{formatTime(t)}</strong>
          </span>
          <input
            type="range"
            min={axis.from}
            max={axis.to}
            step={15}
            value={t}
            onChange={(e) => setT(Number(e.target.value))}
          />
        </label>
        {props.nowMinutes !== null && (
          <button type="button" className="dbtn" onClick={() => setT(Math.round(props.nowMinutes! / 15) * 15)}>
            Now
          </button>
        )}
        <p className="fl-counts">
          <span className="sw s-seated" /> {counts.seated} seated · <span className="sw s-confirmed" /> {counts.booked} booked ·{" "}
          <span className="sw free-sw" /> {counts.free} free
        </p>
      </div>
      <div className="fl-scroll">
      <div className="fl-room" style={{ height }}>
        {placed.map(({ table, x, y }) => {
          const s = states.get(table.id)!;
          const b = "booking" in s ? s.booking : s.kind === "free" ? s.next : undefined;
          const shape = table.shape ?? (table.maxCovers <= 2 ? "round" : table.maxCovers <= 4 ? "square" : "rect");
          return (
            <button
              key={table.id}
              type="button"
              className={`fl-table k-${s.kind} sh-${shape} ${b && props.selectedId === b.id ? "sel" : ""}`}
              style={{ left: `${x}%`, top: y }}
              onClick={() => b && props.onSelect(b.id)}
              disabled={!b}
            >
              <span className="fl-num">
                {table.label} <small>· {table.maxCovers}</small>
              </span>
              {s.kind === "blocked" && <span className="fl-who">{s.reason}</span>}
              {(s.kind === "seated" || s.kind === "due" || s.kind === "late") && (
                <>
                  <span className="fl-who">
                    {s.booking.guestName} {bookingBadges(s.booking)}
                  </span>
                  <span className="fl-when">
                    {s.booking.covers} ·{" "}
                    {s.kind === "seated"
                      ? `until ${formatTime(end(s.booking))}`
                      : s.kind === "late"
                        ? `late, due ${formatTime(s.booking.start)}`
                        : `due ${formatTime(s.booking.start)}`}
                  </span>
                </>
              )}
              {s.kind === "over" && (
                <>
                  <span className="fl-who">
                    {s.booking.guestName} {bookingBadges(s.booking)}
                  </span>
                  <span className="fl-when">
                    {t > end(s.booking) ? `over by ${t - end(s.booking)} min` : "due to finish now"}
                    {s.next && ` · next ${formatTime(s.next.start)}`}
                  </span>
                </>
              )}
              {s.kind === "soon" && (
                <>
                  <span className="fl-who">Free</span>
                  <span className="fl-when">
                    next {formatTime(s.booking.start)} · {s.booking.covers}
                  </span>
                </>
              )}
              {s.kind === "free" && (
                <>
                  <span className="fl-who">Free</span>
                  <span className="fl-when">{s.next ? `next ${formatTime(s.next.start)}` : "nothing later"}</span>
                </>
              )}
            </button>
          );
        })}
      </div>
      </div>
    </section>
  );
}

function BookingPanel(props: {
  booking: DiaryBooking;
  siteSlug: string;
  tables: string[];
  serviceName: string;
  onClose: () => void;
}) {
  const { booking: b } = props;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && props.onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props]);

  const act = (to: DiaryStatus) =>
    startTransition(async () => {
      setError(null);
      const res = await updateStatus(props.siteSlug, b.id, to);
      if (!res.ok) setError(res.error);
      else router.refresh();
    });

  const primary: DiaryStatus[] = ["seated", "completed"];
  const actions = allowedTransitions(b.status);

  return (
    <aside className="panel" aria-label={`Booking for ${b.guestName}`}>
      <div className="panel-head">
        <div>
          <h2>
            {b.guestName} {bookingBadges(b)}
          </h2>
          <p className={`pill s-${b.status}`}>{STATUS_LABEL[b.status]}</p>
        </div>
        <button type="button" className="dbtn" onClick={props.onClose} aria-label="Close">
          ✕
        </button>
      </div>
      <dl className="details">
        <dt>Time</dt>
        <dd>
          {formatTime(b.start)}–{formatTime(end(b))} · {props.serviceName}
        </dd>
        <dt>Guests</dt>
        <dd>{b.covers}</dd>
        <dt>Table</dt>
        <dd>{props.tables.length ? props.tables.join(" + ") : "Not assigned"}</dd>
        {b.guestPhone && (
          <>
            <dt>Phone</dt>
            <dd>
              <a href={`tel:${b.guestPhone}`}>{b.guestPhone}</a>
            </dd>
          </>
        )}
        <dt>History</dt>
        <dd>
          {b.visits === 0 ? "First visit" : `${b.visits} previous visit${b.visits > 1 ? "s" : ""}`}
          {b.noShows > 0 && `, ${b.noShows} no-show${b.noShows > 1 ? "s" : ""}`}
        </dd>
        {b.guestTags.length > 0 && (
          <>
            <dt>Tags</dt>
            <dd>{b.guestTags.join(", ")}</dd>
          </>
        )}
        {b.specialRequests && (
          <>
            <dt>Notes</dt>
            <dd className="notes">{b.specialRequests}</dd>
          </>
        )}
        <dt>Source</dt>
        <dd>{b.channel.replace("_", " ")}</dd>
      </dl>
      <div className="panel-actions">
        {actions.map((to) => (
          <button
            key={to}
            type="button"
            disabled={pending}
            className={primary.includes(to) ? "primary" : to === "cancelled" || to === "no_show" ? "danger-outline" : ""}
            onClick={() => {
              if ((to === "cancelled" || to === "no_show") && !confirm(`${ACTION_LABEL[to]} for ${b.guestName}?`)) return;
              act(to);
            }}
          >
            {ACTION_LABEL[to]}
          </button>
        ))}
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </aside>
  );
}
