"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { FloorOrder, FloorTable, StaffMember } from "@/src/server/orders";
import { formatMoney } from "@/src/pos/totals";
import { openCheck, pinSignOut } from "../actions";

const COURSE_SHORT = ["Drinks", "Starters", "Mains", "Desserts"];
const minutesSince = (d: Date | string) => Math.max(0, Math.round((Date.now() - new Date(d).getTime()) / 60_000));
const hhmm = (d: Date | string) =>
  new Date(d).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });

export default function PosFloor({
  site,
  user,
  floor,
  tips,
}: {
  site: { slug: string; name: string };
  user: StaffMember;
  floor: { tables: FloorTable[]; other: FloorOrder[] };
  /** Top coach nudge per open check. */
  tips: Record<string, { title: string; priority: number }>;
}) {
  const router = useRouter();
  const [opening, setOpening] = useState<FloorTable | "tab" | null>(null);
  const [, tick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
      tick((n) => n + 1);
    }, 15_000);
    return () => clearInterval(id);
  }, [router]);

  const areas = [...new Set(floor.tables.map((t) => t.areaName))];
  const open = floor.tables.filter((t) => t.order);
  const takings = [...open.map((t) => t.order!.total), ...floor.other.map((o) => o.total)].reduce((a, b) => a + b, 0);

  return (
    <main className="page pos-floor">
      <div className="page-head">
        <div>
          <h1>Till · {site.name}</h1>
          <p className="muted small" style={{ margin: 0 }}>
            {open.length + floor.other.length} open check{open.length + floor.other.length === 1 ? "" : "s"} ·{" "}
            {formatMoney(takings)} on open checks
          </p>
        </div>
        <div className="btn-row">
          <button type="button" onClick={() => setOpening("tab")}>
            New tab
          </button>
          <span className="chip info">{user.name}</span>
          <button
            type="button"
            onClick={async () => {
              await pinSignOut();
              router.refresh();
            }}
          >
            Switch user
          </button>
        </div>
      </div>

      {floor.other.length > 0 && (
        <section>
          <h2 className="area-name">Tabs</h2>
          <div className="pos-tables">
            {floor.other.map((o) => (
              <Link key={o.id} href={`/pos/${site.slug}/check/${o.id}`} className="pos-table busy">
                <span className="pt-label">{o.guestName ?? `#${o.number}`}</span>
                <span className="pt-total num">{formatMoney(o.total)}</span>
                <span className="pt-meta">
                  {o.itemCount} items · {minutesSince(o.openedAt)}m
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {areas.map((area) => (
        <section key={area}>
          {areas.length > 1 && <h2 className="area-name">{area}</h2>}
          <div className="pos-tables">
            {floor.tables
              .filter((t) => t.areaName === area)
              .map((t) =>
                t.order ? (
                  <Link key={t.id} href={`/pos/${site.slug}/check/${t.order.id}`} className={`pos-table busy ${t.order.readyToRun ? "ready" : ""}`}>
                    <span className="pt-label">{t.label}</span>
                    <span className="pt-total num">{formatMoney(t.order.total)}</span>
                    <span className="pt-meta">
                      {t.order.covers} cvr · {minutesSince(t.order.openedAt)}m{t.order.guestName ? ` · ${t.order.guestName}` : ""}
                    </span>
                    <span className="pt-flags">
                      {tips[t.order.id] && (
                        <span className={`chip ${tips[t.order.id]!.priority === 1 ? "bad" : tips[t.order.id]!.priority === 2 ? "warn" : ""}`}>
                          {tips[t.order.id]!.title}
                        </span>
                      )}
                      {t.order.readyToRun > 0 && <span className="chip good">{t.order.readyToRun} ready to run</span>}
                      {t.order.heldCourses.filter((c) => c > 0).length > 0 && (
                        <span className="chip warn">
                          {t.order.heldCourses
                            .filter((c) => c > 0)
                            .map((c) => COURSE_SHORT[c] ?? `Course ${c}`)
                            .join(", ")}{" "}
                          held
                        </span>
                      )}
                    </span>
                  </Link>
                ) : (
                  <button key={t.id} type="button" className={`pos-table ${t.booking ? "booked" : ""}`} onClick={() => setOpening(t)}>
                    <span className="pt-label">{t.label}</span>
                    <span className="pt-meta">{t.maxCovers} seats</span>
                    {t.booking && (
                      <span className="pt-flags">
                        <span className="chip info">
                          {t.booking.guestName} · {t.booking.covers} · {hhmm(t.booking.start)}
                        </span>
                      </span>
                    )}
                  </button>
                ),
              )}
          </div>
        </section>
      ))}

      {opening && (
        <OpenDialog
          table={opening === "tab" ? null : opening}
          onClose={() => setOpening(null)}
          onOpen={async (covers, label) => {
            const r = await openCheck(
              site.slug,
              opening === "tab"
                ? { label, covers }
                : { tableId: opening.id, covers, bookingId: opening.booking?.id },
            );
            if (r.ok && r.data) router.push(`/pos/${site.slug}/check/${r.data}`);
            return r;
          }}
        />
      )}
    </main>
  );
}

function OpenDialog(props: {
  table: FloorTable | null;
  onClose: () => void;
  onOpen: (covers: number, label: string) => Promise<{ ok: boolean; error?: string }>;
}) {
  const t = props.table;
  const [covers, setCovers] = useState(t?.booking?.covers ?? (t ? Math.min(2, t.maxCovers) : 1));
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="scrim" onClick={(e) => e.target === e.currentTarget && props.onClose()}>
      <form
        className="dialog"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          const r = await props.onOpen(covers, label);
          setBusy(false);
          if (!r.ok) setError(r.error ?? "Couldn't open the check");
        }}
      >
        <h2>{t ? `Table ${t.label}` : "New tab"}</h2>
        {t?.booking && (
          <p className="chip info" style={{ justifySelf: "start" }}>
            Booked: {t.booking.guestName}, {t.booking.covers} at {hhmm(t.booking.start)}. Opening seats them.
          </p>
        )}
        {!t && (
          <label>
            Name
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Bar – Alex" required autoFocus />
          </label>
        )}
        <div>
          <span className="lbl">Guests</span>
          <div className="covers-pick">
            {Array.from({ length: Math.max(8, t?.maxCovers ?? 0) }, (_, i) => i + 1).map((n) => (
              <button key={n} type="button" className={n === covers ? "on" : ""} onClick={() => setCovers(n)}>
                {n}
              </button>
            ))}
          </div>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" onClick={props.onClose}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={busy}>
            Open check
          </button>
        </div>
      </form>
    </div>
  );
}
