"use client";

import { useEffect, useState } from "react";
import { formatTime } from "@/src/lib/api";
import { staffBook, staffSlots, walkIn } from "../actions";

type Mode = "walkin" | "booking";

export default function NewBooking(props: {
  siteSlug: string;
  date: string;
  today: string;
  tables: { id: string; label: string; maxCovers: number }[];
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [mode, setMode] = useState<Mode>(props.date === props.today ? "walkin" : "booking");
  const [covers, setCovers] = useState(2);
  const [tableId, setTableId] = useState("");
  const [date, setDate] = useState(props.date < props.today ? props.today : props.date);
  const [slots, setSlots] = useState<{ serviceId: string; time: number }[] | null>(null);
  const [slot, setSlot] = useState<{ serviceId: string; time: number } | null>(null);
  const [guest, setGuest] = useState({ firstName: "", lastName: "", phone: "", email: "" });
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (mode !== "booking") return;
    let stale = false;
    setSlots(null);
    setSlot(null);
    staffSlots(props.siteSlug, date, covers).then((r) => {
      if (stale) return;
      if (r.ok) setSlots(r.slots);
      else setError(r.error);
    });
    return () => {
      stale = true;
    };
  }, [mode, date, covers, props.siteSlug]);

  const g = (k: keyof typeof guest) => (e: React.ChangeEvent<HTMLInputElement>) => setGuest((cur) => ({ ...cur, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const r =
      mode === "walkin"
        ? await walkIn(props.siteSlug, { covers, tableId: tableId || null, guest })
        : slot
          ? await staffBook(props.siteSlug, { date, serviceId: slot.serviceId, time: slot.time, covers, guest, notes })
          : { ok: false as const, error: "Pick a time" };
    setBusy(false);
    if (!r.ok) return setError(r.error);
    props.onDone(mode === "walkin" ? `Seated ${covers}` : `Booked ${guest.firstName} at ${formatTime(slot!.time)}`);
  }

  return (
    <div className="scrim" onClick={(e) => e.target === e.currentTarget && props.onClose()}>
      <form className="dialog new-booking" onSubmit={submit}>
        <div className="seg" role="tablist" aria-label="Type">
          <button type="button" role="tab" aria-selected={mode === "walkin"} onClick={() => setMode("walkin")}>
            Walk-in now
          </button>
          <button type="button" role="tab" aria-selected={mode === "booking"} onClick={() => setMode("booking")}>
            Booking
          </button>
        </div>

        <div>
          <span className="lbl">Guests</span>
          <div className="covers-row">
            {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
              <button key={n} type="button" className={n === covers ? "on" : ""} onClick={() => setCovers(n)}>
                {n}
              </button>
            ))}
            <input
              type="number"
              min={1}
              max={50}
              value={covers}
              onChange={(e) => setCovers(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
              aria-label="Guests"
              style={{ width: 70 }}
            />
          </div>
        </div>

        {mode === "walkin" ? (
          <label>
            Table
            <select value={tableId} onChange={(e) => setTableId(e.target.value)}>
              <option value="">Best free table</option>
              {props.tables.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label} (seats {t.maxCovers})
                </option>
              ))}
            </select>
          </label>
        ) : (
          <>
            <label>
              Date
              <input type="date" value={date} min={props.today} onChange={(e) => e.target.value && setDate(e.target.value)} />
            </label>
            <div>
              <span className="lbl">Time</span>
              {slots === null ? (
                <p className="muted small">Checking tables…</p>
              ) : slots.length === 0 ? (
                <p className="muted small">Nothing free for {covers} on this day.</p>
              ) : (
                <div className="time-grid">
                  {slots.map((s) => (
                    <button
                      key={`${s.serviceId}-${s.time}`}
                      type="button"
                      className={slot?.time === s.time && slot.serviceId === s.serviceId ? "on" : ""}
                      onClick={() => setSlot(s)}
                    >
                      {formatTime(s.time)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        <div className="row">
          <label>
            {mode === "walkin" ? "Name (optional)" : "First name"}
            <input value={guest.firstName} onChange={g("firstName")} required={mode === "booking"} />
          </label>
          <label>
            Last name
            <input value={guest.lastName} onChange={g("lastName")} />
          </label>
        </div>
        <div className="row">
          <label>
            Phone
            <input type="tel" value={guest.phone} onChange={g("phone")} />
          </label>
          <label>
            Email {mode === "booking" && <span className="muted small">(sends a confirmation)</span>}
            <input type="email" value={guest.email} onChange={g("email")} />
          </label>
        </div>
        {mode === "booking" && (
          <label>
            Notes
            <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Allergies, occasion, high chair…" maxLength={500} />
          </label>
        )}
        {error && (
          <p className="error" role="alert" style={{ margin: 0 }}>
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" onClick={props.onClose}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={busy || (mode === "booking" && !slot)}>
            {mode === "walkin" ? "Seat now" : "Book"}
          </button>
        </div>
      </form>
    </div>
  );
}
