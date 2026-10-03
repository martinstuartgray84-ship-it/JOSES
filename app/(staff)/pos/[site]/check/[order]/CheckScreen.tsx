"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import type { MenuCategory, MenuItem } from "@/src/server/menu";
import type { OrderItemView, OrderView, StaffMember } from "@/src/server/orders";
import { formatMoney, splitBySeat, splitEqually } from "@/src/pos/totals";
import { nextCourseToFire } from "@/src/kitchen/sequencing";
import { parseMoney } from "@/src/menu/import";
import {
  addToCheck,
  applyDiscount,
  applyServiceCharge,
  changeCovers,
  changeItem,
  closeFree,
  compCheckItem,
  deleteItem,
  markServed,
  moveCheck,
  pay,
  send,
  voidCheck,
} from "../../../actions";

const COURSES = ["Drinks", "Starters", "Mains", "Desserts", "Course 4", "Course 5", "Course 6", "Course 7", "Course 8", "Course 9"];
const STATUS_TEXT: Record<OrderItemView["status"], string> = {
  held: "Not sent",
  sent: "Sent",
  started: "Cooking",
  ready: "Ready",
  served: "Served",
  void: "Void",
};
const STATUS_CLASS: Record<OrderItemView["status"], string> = {
  held: "warn",
  sent: "info",
  started: "info",
  ready: "good",
  served: "",
  void: "bad",
};

type Result = { ok: boolean; error?: string };

export default function CheckScreen({
  site,
  user,
  order,
  menu,
  freeTables,
}: {
  site: { slug: string; name: string };
  user: StaffMember;
  order: OrderView;
  menu: MenuCategory[];
  freeTables: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [catId, setCatId] = useState(menu[0]?.id ?? "");
  const [seat, setSeat] = useState<number | null>(null);
  const [courseOverride, setCourseOverride] = useState<number | null>(null);
  const [picking, setPicking] = useState<MenuItem | null>(null);
  const [selected, setSelected] = useState<OrderItemView | null>(null);
  const [panel, setPanel] = useState<"pay" | "more" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [search, setSearch] = useState("");

  const open = order.status === "open";
  const t = order.totals;

  // Kitchen progress changes under us: keep the check fresh.
  useEffect(() => {
    const id = setInterval(() => document.visibilityState === "visible" && router.refresh(), 8_000);
    return () => clearInterval(id);
  }, [router]);
  useEffect(() => {
    if (!flash) return;
    const id = setTimeout(() => setFlash(null), 2500);
    return () => clearTimeout(id);
  }, [flash]);

  const run = (fn: () => Promise<Result & { data?: unknown }>, done?: string | ((r: Result & { data?: unknown }) => string | null)) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (!r.ok) setError(r.error ?? "Something went wrong");
      else {
        const msg = typeof done === "function" ? done(r) : done;
        if (msg) setFlash(msg);
        router.refresh();
      }
    });

  const held = order.items.filter((i) => i.status === "held");
  const sentFood = order.items.filter((i) => i.status !== "held" && i.status !== "void" && i.course > 0);
  // "Send": drinks always; food up to the first held course if nothing's gone yet,
  // otherwise up to the highest course already in the kitchen (add-ons to the current course).
  const sendUpTo = useMemo(() => {
    const heldFood = held.filter((i) => i.course > 0).map((i) => i.course);
    if (sentFood.length === 0) return heldFood.length ? Math.min(...heldFood) : 0;
    return Math.max(...sentFood.map((i) => i.course));
  }, [held, sentFood]);
  const sendCount = held.filter((i) => i.course === 0 || i.course <= sendUpTo).length;
  const fireNext = nextCourseToFire(order.courses);
  const heldCourses = order.courses.filter((c) => c.state === "held" && c.course > 0 && c.course > sendUpTo);
  const readyCount = order.items.filter((i) => i.status === "ready").length;

  const q = search.trim().toLowerCase();
  const items = q
    ? menu.flatMap((c) => c.items).filter((i) => i.name.toLowerCase().includes(q))
    : (menu.find((c) => c.id === catId)?.items ?? []);

  const addQuick = (item: MenuItem) => {
    if (!open) return;
    if (item.modifierGroups.length) return setPicking(item);
    run(() => addToCheck(site.slug, order.id, { menuItemId: item.id, seat, course: courseOverride }), `+ ${item.name}`);
  };

  const byCourse = order.courses.length
    ? order.courses.map((c) => ({ ...c, items: order.items.filter((i) => i.course === c.course && i.status !== "void") }))
    : [];
  const voided = order.items.filter((i) => i.status === "void");

  return (
    <main className="pos-check">
      <section className="check-menu" aria-label="Menu">
        <div className="check-head">
          <Link href={`/pos/${site.slug}`} className="dbtn" aria-label="Back to tables">
            ‹ Tables
          </Link>
          <input type="search" placeholder="Search menu" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search menu" />
        </div>
        {!q && (
          <div className="cat-tabs" role="tablist" aria-label="Categories">
            {menu.map((c) => (
              <button key={c.id} role="tab" aria-selected={c.id === catId} onClick={() => setCatId(c.id)}>
                {c.name}
              </button>
            ))}
          </div>
        )}
        <div className="order-opts">
          <div className="opt-group" role="group" aria-label="Seat">
            <span className="lbl">Seat</span>
            <button type="button" className={seat === null ? "on" : ""} onClick={() => setSeat(null)}>
              Share
            </button>
            {Array.from({ length: order.covers }, (_, i) => i + 1).map((s) => (
              <button key={s} type="button" className={seat === s ? "on" : ""} onClick={() => setSeat(s)}>
                {s}
              </button>
            ))}
          </div>
          <div className="opt-group" role="group" aria-label="Course">
            <span className="lbl">Course</span>
            <button type="button" className={courseOverride === null ? "on" : ""} onClick={() => setCourseOverride(null)}>
              Auto
            </button>
            {[1, 2, 3].map((c) => (
              <button key={c} type="button" className={courseOverride === c ? "on" : ""} onClick={() => setCourseOverride(c)}>
                {COURSES[c]}
              </button>
            ))}
          </div>
        </div>
        <div className="item-grid">
          {items.map((i) => (
            <button
              key={i.id}
              type="button"
              className={`item-btn ${i.available ? "" : "off"}`}
              disabled={!i.available || !open || pending}
              onClick={() => addQuick(i)}
            >
              <span className="ib-name">{i.name}</span>
              <span className="ib-meta">
                <span className="num">{formatMoney(i.price)}</span>
                {!i.available ? (
                  <span className="chip bad">86</span>
                ) : i.stockRemaining !== null ? (
                  <span className="chip warn">{i.stockRemaining} left</span>
                ) : null}
                {i.modifierGroups.length > 0 && <span className="ib-more">⋯</span>}
              </span>
              {i.allergens.length > 0 && <span className="ib-allergens">{i.allergens.join(" · ")}</span>}
            </button>
          ))}
          {items.length === 0 && <p className="muted">Nothing here.</p>}
        </div>
      </section>

      <section className="check-bill" aria-label="Check">
        <header className="bill-head">
          <div>
            <h1>
              {order.tableLabel ?? "Tab"} <span className="muted">#{order.number}</span>
            </h1>
            <p className="muted small" style={{ margin: 0 }}>
              {order.covers} cover{order.covers === 1 ? "" : "s"} · opened by {order.openedBy ?? "?"} at{" "}
              {new Date(order.openedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" })}
              {order.status !== "open" && ` · ${order.status === "paid" ? "PAID" : "VOID"}`}
            </p>
          </div>
          {open && (
            <button type="button" className="dbtn" onClick={() => setPanel("more")}>
              More
            </button>
          )}
        </header>

        {order.guestName && (
          <div className="guest-strip">
            <strong>{order.guestName}</strong>
            {order.guestNotes && order.guestNotes.visits >= 3 && <span className="chip good">★ regular · {order.guestNotes.visits} visits</span>}
            {order.guestNotes && order.guestNotes.visits > 0 && order.guestNotes.visits < 3 && (
              <span className="chip">{order.guestNotes.visits} previous visit{order.guestNotes.visits > 1 ? "s" : ""}</span>
            )}
            {order.guestNotes?.allergies && <span className="chip bad">Note: {order.guestNotes.allergies}</span>}
          </div>
        )}

        <div className="bill-lines">
          {order.items.length === 0 && <p className="muted empty">Tap items on the left to add them.</p>}
          {byCourse.map((c) => (
            <div key={c.course} className="course-block">
              <div className="course-head">
                <span>{COURSES[c.course] ?? `Course ${c.course}`}</span>
                <span className={`chip ${c.state === "held" ? "warn" : c.state === "ready" ? "good" : c.state === "cooking" ? "info" : ""}`}>
                  {c.state === "held" ? (c.course === 0 || c.course <= sendUpTo ? "not sent" : "on hold") : c.state}
                </span>
                {open && c.state === "held" && c.course > 0 && sentFood.length > 0 && (
                  <button
                    type="button"
                    className={`fire ${fireNext?.course === c.course ? "primary" : ""}`}
                    disabled={pending}
                    onClick={() => run(() => send(site.slug, order.id, { only: [c.course] }), `${COURSES[c.course]} away`)}
                  >
                    Fire {COURSES[c.course]?.toLowerCase()} · ~{c.needsMinutes}m
                  </button>
                )}
              </div>
              {c.items.map((i) => (
                <button key={i.id} type="button" className={`line ${i.comped ? "comped" : ""}`} onClick={() => open && setSelected(i)}>
                  <span className="l-qty num">{i.quantity}×</span>
                  <span className="l-name">
                    <span>
                      {i.name}
                      {i.seat && <span className="seat-tag">S{i.seat}</span>}
                    </span>
                    {(i.modifiers.length > 0 || i.notes) && (
                      <span className="l-detail">{[...i.modifiers.map((m) => m.option), i.notes].filter(Boolean).join(" · ")}</span>
                    )}
                  </span>
                  <span className={`chip ${STATUS_CLASS[i.status]}`}>{STATUS_TEXT[i.status]}</span>
                  <span className="l-price num">
                    {i.comped ? "comp" : formatMoney((i.unitPrice + i.modifiersTotal) * i.quantity)}
                  </span>
                </button>
              ))}
            </div>
          ))}
          {voided.length > 0 && (
            <details className="voided">
              <summary>{voided.length} voided</summary>
              {voided.map((i) => (
                <div key={i.id} className="small muted">
                  {i.quantity}× {i.name}: {i.voidReason}
                </div>
              ))}
            </details>
          )}
        </div>

        <div className="bill-totals">
          {t.discount > 0 && (
            <div>
              <span>Discount{order.discount?.reason ? ` (${order.discount.reason})` : ""}</span>
              <span className="num">−{formatMoney(t.discount)}</span>
            </div>
          )}
          {t.serviceCharge > 0 && (
            <div>
              <span>Service {order.serviceChargePct}%</span>
              <span className="num">{formatMoney(t.serviceCharge)}</span>
            </div>
          )}
          {t.paid > 0 && (
            <div>
              <span>Paid</span>
              <span className="num">−{formatMoney(t.paid)}</span>
            </div>
          )}
          <div className="grand">
            <span>{t.paid > 0 ? "Left to pay" : "Total"}</span>
            <span className="num">{formatMoney(Math.max(0, t.balance))}</span>
          </div>
        </div>

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {flash && (
          <p className="flash" role="status">
            {flash}
          </p>
        )}

        {open ? (
          <div className="bill-actions">
            {readyCount > 0 && (
              <button type="button" disabled={pending} onClick={() => run(() => markServed(site.slug, order.id), "Marked as served")}>
                Served ({readyCount})
              </button>
            )}
            <button
              type="button"
              className="send primary"
              disabled={pending || sendCount === 0}
              onClick={() => run(() => send(site.slug, order.id, { upTo: sendUpTo }), (r) => `Sent ${r.data} item${r.data === 1 ? "" : "s"}`)}
            >
              Send{sendCount ? ` ${sendCount}` : ""}
              {heldCourses.length > 0 && sendCount > 0 && <small> · holds {heldCourses.map((c) => COURSES[c.course]?.toLowerCase()).join(", ")}</small>}
            </button>
            <button type="button" className="pay" disabled={pending || t.total === 0 && order.items.length === 0} onClick={() => setPanel("pay")}>
              Pay {formatMoney(Math.max(0, t.balance))}
            </button>
          </div>
        ) : (
          <div className="bill-actions">
            <Link href={`/pos/${site.slug}`} className="primary btn-link">
              Back to tables
            </Link>
          </div>
        )}
      </section>

      {picking && (
        <ModifierDialog
          item={picking}
          seat={seat}
          covers={order.covers}
          course={courseOverride}
          onClose={() => setPicking(null)}
          onAdd={async (input) => {
            const r = await addToCheck(site.slug, order.id, { menuItemId: picking.id, ...input });
            if (r.ok) {
              setPicking(null);
              setFlash(`+ ${picking.name}`);
              router.refresh();
            }
            return r;
          }}
        />
      )}

      {selected && (
        <ItemDialog
          item={selected}
          covers={order.covers}
          onClose={() => setSelected(null)}
          act={async (fn) => {
            const r = await fn();
            if (r.ok) {
              setSelected(null);
              router.refresh();
            }
            return r;
          }}
          siteSlug={site.slug}
          orderId={order.id}
        />
      )}

      {panel === "pay" && (
        <PayPanel
          order={order}
          siteSlug={site.slug}
          onClose={() => setPanel(null)}
          onDone={() => router.refresh()}
        />
      )}

      {panel === "more" && (
        <MoreDialog
          order={order}
          siteSlug={site.slug}
          freeTables={freeTables}
          onClose={() => setPanel(null)}
          onDone={(goHome) => {
            setPanel(null);
            if (goHome) router.push(`/pos/${site.slug}`);
            else router.refresh();
          }}
        />
      )}
      <span hidden>{user.name}</span>
    </main>
  );
}

function ModifierDialog(props: {
  item: MenuItem;
  seat: number | null;
  covers: number;
  course: number | null;
  onClose: () => void;
  onAdd: (input: { optionIds: string[]; quantity: number; seat: number | null; course: number | null; notes: string | null }) => Promise<Result>;
}) {
  const { item } = props;
  const [chosen, setChosen] = useState<Record<string, string[]>>({});
  const [qty, setQty] = useState(1);
  const [seat, setSeat] = useState(props.seat);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const toggle = (groupId: string, optionId: string, max: number) =>
    setChosen((cur) => {
      const list = cur[groupId] ?? [];
      if (list.includes(optionId)) return { ...cur, [groupId]: list.filter((x) => x !== optionId) };
      if (max === 1) return { ...cur, [groupId]: [optionId] };
      if (list.length >= max) return cur;
      return { ...cur, [groupId]: [...list, optionId] };
    });
  const missing = item.modifierGroups.filter((g) => (chosen[g.id]?.length ?? 0) < g.minSelect);
  const extra = item.modifierGroups.flatMap((g) => g.options.filter((o) => chosen[g.id]?.includes(o.id))).reduce((n, o) => n + o.priceDelta, 0);

  return (
    <div className="scrim" onClick={(e) => e.target === e.currentTarget && props.onClose()}>
      <form
        className="dialog"
        onSubmit={async (e) => {
          e.preventDefault();
          if (missing.length) return setError(`Choose ${missing.map((g) => g.name.toLowerCase()).join(" and ")}`);
          setBusy(true);
          const r = await props.onAdd({ optionIds: Object.values(chosen).flat(), quantity: qty, seat, course: props.course, notes: notes || null });
          setBusy(false);
          if (!r.ok) setError(r.error ?? "Couldn't add");
        }}
      >
        <h2>{item.name}</h2>
        {item.modifierGroups.map((g) => (
          <fieldset key={g.id} className="mod-group">
            <legend>
              {g.name}{" "}
              <span className="muted small">
                {g.minSelect ? "required" : "optional"}
                {g.maxSelect > 1 ? `, up to ${g.maxSelect}` : ""}
              </span>
            </legend>
            <div className="mod-options">
              {g.options.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  className={chosen[g.id]?.includes(o.id) ? "on" : ""}
                  aria-pressed={!!chosen[g.id]?.includes(o.id)}
                  onClick={() => toggle(g.id, o.id, g.maxSelect)}
                >
                  {o.name}
                  {o.priceDelta !== 0 && <small className="num"> {o.priceDelta > 0 ? "+" : "−"}{formatMoney(Math.abs(o.priceDelta))}</small>}
                </button>
              ))}
            </div>
          </fieldset>
        ))}
        <div className="row">
          <div>
            <span className="lbl">Quantity</span>
            <div className="stepper">
              <button type="button" onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="Fewer">
                −
              </button>
              <span className="num">{qty}</span>
              <button type="button" onClick={() => setQty((q) => Math.min(99, q + 1))} aria-label="More">
                +
              </button>
            </div>
          </div>
          <div>
            <span className="lbl">Seat</span>
            <div className="opt-group">
              <button type="button" className={seat === null ? "on" : ""} onClick={() => setSeat(null)}>
                Share
              </button>
              {Array.from({ length: props.covers }, (_, i) => i + 1).map((s) => (
                <button key={s} type="button" className={seat === s ? "on" : ""} onClick={() => setSeat(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        </div>
        <label>
          Note for the kitchen
          <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. no onions" maxLength={200} />
        </label>
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
            Add · {formatMoney((item.price + extra) * qty)}
          </button>
        </div>
      </form>
    </div>
  );
}

function ItemDialog(props: {
  item: OrderItemView;
  covers: number;
  siteSlug: string;
  orderId: string;
  onClose: () => void;
  act: (fn: () => Promise<Result>) => Promise<Result>;
}) {
  const { item: i, siteSlug, orderId } = props;
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const held = i.status === "held";
  const go = async (fn: () => Promise<Result>) => {
    setError(null);
    const r = await props.act(fn);
    if (!r.ok) setError(r.error ?? "Couldn't change it");
  };
  return (
    <div className="scrim" onClick={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className="dialog">
        <h2>
          {i.quantity}× {i.name}
        </h2>
        <p className="muted small" style={{ margin: 0 }}>
          {STATUS_TEXT[i.status]}
          {i.addedBy ? ` · added by ${i.addedBy}` : ""}
          {i.modifiers.length ? ` · ${i.modifiers.map((m) => m.option).join(", ")}` : ""}
          {i.notes ? ` · "${i.notes}"` : ""}
        </p>
        {held && (
          <>
            <div className="row">
              <div>
                <span className="lbl">Quantity</span>
                <div className="stepper">
                  <button type="button" disabled={i.quantity <= 1} onClick={() => go(() => changeItem(siteSlug, orderId, i.id, { quantity: i.quantity - 1 }))}>
                    −
                  </button>
                  <span className="num">{i.quantity}</span>
                  <button type="button" onClick={() => go(() => changeItem(siteSlug, orderId, i.id, { quantity: i.quantity + 1 }))}>
                    +
                  </button>
                </div>
              </div>
              <div>
                <span className="lbl">Course</span>
                <div className="opt-group">
                  {[0, 1, 2, 3].map((c) => (
                    <button key={c} type="button" className={i.course === c ? "on" : ""} onClick={() => go(() => changeItem(siteSlug, orderId, i.id, { course: c }))}>
                      {COURSES[c]}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div>
              <span className="lbl">Seat</span>
              <div className="opt-group">
                <button type="button" className={i.seat === null ? "on" : ""} onClick={() => go(() => changeItem(siteSlug, orderId, i.id, { seat: null }))}>
                  Share
                </button>
                {Array.from({ length: props.covers }, (_, n) => n + 1).map((s) => (
                  <button key={s} type="button" className={i.seat === s ? "on" : ""} onClick={() => go(() => changeItem(siteSlug, orderId, i.id, { seat: s }))}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
        {!held && (
          <label>
            Reason (needed to void or comp)
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. sent back, wrong order" maxLength={200} />
          </label>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          {held ? (
            <button type="button" className="danger-outline" onClick={() => go(() => deleteItem(siteSlug, orderId, i.id))}>
              Remove
            </button>
          ) : (
            <button type="button" className="danger-outline" disabled={!reason.trim()} onClick={() => go(() => deleteItem(siteSlug, orderId, i.id, reason))}>
              Void
            </button>
          )}
          {i.comped ? (
            <button type="button" onClick={() => go(() => compCheckItem(siteSlug, orderId, i.id, null))}>
              Remove comp
            </button>
          ) : (
            <button
              type="button"
              disabled={!held && !reason.trim()}
              onClick={() => go(() => compCheckItem(siteSlug, orderId, i.id, reason.trim() || "On the house"))}
            >
              Comp
            </button>
          )}
          <button type="button" className="primary" onClick={props.onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

function PayPanel(props: { order: OrderView; siteSlug: string; onClose: () => void; onDone: () => void }) {
  const { order } = props;
  const t = order.totals;
  const owed = Math.max(0, t.balance);
  const [amount, setAmount] = useState((owed / 100).toFixed(2));
  const [tip, setTip] = useState("");
  const [splitWays, setSplitWays] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ closed: boolean; change: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const seats = [...new Set(order.items.map((i) => i.seat).filter((s): s is number => s != null))];
  const bySeat = seats.length
    ? splitBySeat({
        lines: order.items.map((i) => ({ unitPrice: i.unitPrice, modifiersTotal: i.modifiersTotal, quantity: i.quantity, vatRate: i.vatRate, comped: i.comped, voided: i.status === "void", seat: i.seat })),
        seats: Array.from({ length: Math.max(order.covers, ...seats) }, (_, n) => n + 1),
        discount: order.discount,
        serviceChargePct: order.serviceChargePct,
      })
    : [];

  const take = async (method: "card" | "cash" | "voucher" | "other") => {
    const pence = parseMoney(amount);
    const tipPence = tip ? parseMoney(tip) : 0;
    if (pence === null || pence <= 0) return setError("Enter an amount like 25.00");
    if (tipPence === null || tipPence < 0) return setError("Enter a tip like 3.00, or leave it blank");
    setBusy(true);
    setError(null);
    const r = await pay(props.siteSlug, order.id, { method, amount: pence, tip: tipPence });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setResult(r.data!);
    setTip("");
    if (!r.data!.closed) setAmount((r.data!.balance / 100).toFixed(2));
    props.onDone();
  };

  if (result?.closed) {
    return (
      <div className="scrim">
        <div className="dialog pay-done">
          <h2>Paid</h2>
          {result.change > 0 && (
            <p className="change">
              Change due <strong className="num">{formatMoney(result.change)}</strong>
            </p>
          )}
          <Receipt order={order} />
          <div className="dialog-actions">
            <Link href={`/pos/${props.siteSlug}`} className="primary btn-link">
              Back to tables
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="scrim" onClick={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className="dialog pay-dialog">
        <h2>Pay · {formatMoney(owed)} to pay</h2>
        <Receipt order={order} compact />
        {owed === 0 ? (
          <>
            <p className="muted">Nothing to pay (everything comped).</p>
            <div className="dialog-actions">
              <button
                type="button"
                className="primary"
                onClick={async () => {
                  const r = await closeFree(props.siteSlug, order.id);
                  if (!r.ok) setError(r.error);
                  else setResult({ closed: true, change: 0 });
                }}
              >
                Close check
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="split-row">
              <span className="lbl">Split</span>
              <div className="opt-group">
                <button type="button" className={splitWays === 0 ? "on" : ""} onClick={() => { setSplitWays(0); setAmount((owed / 100).toFixed(2)); }}>
                  All
                </button>
                {[2, 3, 4, 5, 6].map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={splitWays === n ? "on" : ""}
                    onClick={() => {
                      setSplitWays(n);
                      setAmount((splitEqually(owed, n)[0]! / 100).toFixed(2));
                    }}
                  >
                    ÷{n}
                  </button>
                ))}
              </div>
            </div>
            {splitWays > 1 && (
              <p className="small muted" style={{ margin: 0 }}>
                {splitWays} ways: {splitEqually(owed, splitWays).map(formatMoney).join(" / ")}
              </p>
            )}
            {bySeat.length > 0 && t.paid === 0 && (
              <div className="seat-split">
                <span className="lbl">By seat</span>
                <div className="opt-group">
                  {bySeat.map((s) => (
                    <button key={s.seat} type="button" onClick={() => setAmount((s.amount / 100).toFixed(2))}>
                      S{s.seat} {formatMoney(s.amount)}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="row">
              <label>
                Amount (£)
                <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />
              </label>
              <label>
                Tip (£)
                <input value={tip} onChange={(e) => setTip(e.target.value)} inputMode="decimal" placeholder="0.00" />
              </label>
            </div>
            <div className="quick-cash">
              {[1000, 2000, 5000].filter((n) => n >= owed / 3).map((n) => (
                <button key={n} type="button" onClick={() => setAmount((n / 100).toFixed(2))}>
                  {formatMoney(n)}
                </button>
              ))}
            </div>
            {result && !result.closed && <p className="flash">Payment taken. {formatMoney(owed)} still to pay.</p>}
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <div className="pay-methods">
              <button type="button" className="primary" disabled={busy} onClick={() => take("card")}>
                Card
              </button>
              <button type="button" disabled={busy} onClick={() => take("cash")}>
                Cash
              </button>
              <button type="button" disabled={busy} onClick={() => take("voucher")}>
                Voucher
              </button>
            </div>
            <p className="small muted" style={{ margin: 0 }}>
              Take the card on your terminal first, then press Card. Card and voucher can&rsquo;t exceed what&rsquo;s owed; put extra on as a tip.
            </p>
          </>
        )}
        <div className="dialog-actions">
          <button type="button" onClick={props.onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function Receipt({ order, compact }: { order: OrderView; compact?: boolean }) {
  const t = order.totals;
  const lines = order.items.filter((i) => i.status !== "void");
  return (
    <div className={`receipt ${compact ? "compact" : ""}`}>
      {!compact &&
        lines.map((i) => (
          <div key={i.id}>
            <span>
              {i.quantity}× {i.name}
            </span>
            <span className="num">{i.comped ? "comp" : formatMoney((i.unitPrice + i.modifiersTotal) * i.quantity)}</span>
          </div>
        ))}
      <div>
        <span>Items</span>
        <span className="num">{formatMoney(t.itemsTotal)}</span>
      </div>
      {t.discount > 0 && (
        <div>
          <span>Discount</span>
          <span className="num">−{formatMoney(t.discount)}</span>
        </div>
      )}
      {t.serviceCharge > 0 && (
        <div>
          <span>Service ({order.serviceChargePct}%, optional)</span>
          <span className="num">{formatMoney(t.serviceCharge)}</span>
        </div>
      )}
      <div className="grand">
        <span>Total</span>
        <span className="num">{formatMoney(t.total)}</span>
      </div>
      {t.vat.map((v) => (
        <div key={v.rate} className="vat">
          <span>
            VAT {v.rate}% on {formatMoney(v.gross)}
          </span>
          <span className="num">{formatMoney(v.vat)}</span>
        </div>
      ))}
      {order.payments.map((p) => (
        <div key={p.id} className="vat">
          <span>
            {p.method}
            {p.tip ? ` (+${formatMoney(p.tip)} tip)` : ""}
          </span>
          <span className="num">{formatMoney(p.amount)}</span>
        </div>
      ))}
    </div>
  );
}

function MoreDialog(props: {
  order: OrderView;
  siteSlug: string;
  freeTables: { id: string; label: string }[];
  onClose: () => void;
  onDone: (goHome: boolean) => void;
}) {
  const { order, siteSlug } = props;
  const [discKind, setDiscKind] = useState<"percent" | "amount">(order.discount?.kind ?? "percent");
  const [discValue, setDiscValue] = useState(order.discount ? (order.discount.kind === "amount" ? (order.discount.value / 100).toFixed(2) : String(order.discount.value)) : "");
  const [discReason, setDiscReason] = useState(order.discount?.reason ?? "");
  const [service, setService] = useState(String(order.serviceChargePct));
  const [covers, setCoversV] = useState(order.covers);
  const [moveTo, setMoveTo] = useState("");
  const [voidReason, setVoidReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const go = async (fn: () => Promise<Result>, goHome = false) => {
    setError(null);
    const r = await fn();
    if (!r.ok) setError(r.error ?? "Couldn't do that");
    else props.onDone(goHome);
  };
  return (
    <div className="scrim" onClick={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className="dialog">
        <h2>Check options</h2>
        <fieldset className="more-box">
          <legend>Discount</legend>
          <div className="row">
            <label>
              Type
              <select value={discKind} onChange={(e) => setDiscKind(e.target.value as "percent" | "amount")}>
                <option value="percent">%</option>
                <option value="amount">£</option>
              </select>
            </label>
            <label>
              {discKind === "percent" ? "Percent" : "Amount (£)"}
              <input value={discValue} onChange={(e) => setDiscValue(e.target.value)} inputMode="decimal" />
            </label>
            <label>
              Reason
              <input value={discReason} onChange={(e) => setDiscReason(e.target.value)} placeholder="e.g. staff, complaint" />
            </label>
          </div>
          <div className="btn-row">
            <button
              type="button"
              onClick={() => {
                const v = discKind === "percent" ? Number(discValue) : parseMoney(discValue);
                if (!v || v <= 0 || !Number.isInteger(v)) return setError(discKind === "percent" ? "Whole percent, e.g. 10" : "Amount like 5.00");
                go(() => applyDiscount(siteSlug, order.id, { kind: discKind, value: v, reason: discReason }));
              }}
            >
              Apply discount
            </button>
            {order.discount && (
              <button type="button" onClick={() => go(() => applyDiscount(siteSlug, order.id, null))}>
                Remove discount
              </button>
            )}
          </div>
        </fieldset>
        <div className="row">
          <label>
            Service charge %
            <select value={service} onChange={(e) => setService(e.target.value)}>
              {["0", "10", "12.5", "15"].map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <button type="button" style={{ alignSelf: "end" }} onClick={() => go(() => applyServiceCharge(siteSlug, order.id, Number(service)))}>
            Set
          </button>
          <label>
            Covers
            <input type="number" min={1} max={100} value={covers} onChange={(e) => setCoversV(Number(e.target.value))} />
          </label>
          <button type="button" style={{ alignSelf: "end" }} onClick={() => go(() => changeCovers(siteSlug, order.id, covers))}>
            Set
          </button>
        </div>
        {order.tableId && props.freeTables.length > 0 && (
          <div className="row">
            <label>
              Move to table
              <select value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
                <option value="">Choose</option>
                {props.freeTables.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" style={{ alignSelf: "end" }} disabled={!moveTo} onClick={() => go(() => moveCheck(siteSlug, order.id, moveTo))}>
              Move
            </button>
          </div>
        )}
        {order.totals.paid === 0 && (
          <div className="row">
            <label>
              Void the whole check (reason)
              <input value={voidReason} onChange={(e) => setVoidReason(e.target.value)} placeholder="e.g. opened by mistake" />
            </label>
            <button type="button" className="danger-outline" style={{ alignSelf: "end" }} disabled={!voidReason.trim()} onClick={() => go(() => voidCheck(siteSlug, order.id, voidReason), true)}>
              Void check
            </button>
          </div>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" className="primary" onClick={props.onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
