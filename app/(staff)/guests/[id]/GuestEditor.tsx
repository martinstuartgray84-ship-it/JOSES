"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { saveGuest } from "../actions";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export default function GuestEditor({
  guest,
}: {
  guest: {
    id: string;
    firstName: string;
    lastName: string | null;
    email: string | null;
    phone: string | null;
    notes: string | null;
    tags: string[];
    allergies: string | null;
    birthdayMonth: number | null;
    birthdayDay: number | null;
    marketingOptIn: boolean;
    consentAt: string | null;
    consentSource: string | null;
    unsubscribedAt: string | null;
  };
}) {
  const router = useRouter();
  const [f, setF] = useState({
    firstName: guest.firstName,
    lastName: guest.lastName ?? "",
    email: guest.email ?? "",
    phone: guest.phone ?? "",
    notes: guest.notes ?? "",
    allergies: guest.allergies ?? "",
    tags: guest.tags.join(", "),
    birthdayMonth: guest.birthdayMonth ? String(guest.birthdayMonth) : "",
    birthdayDay: guest.birthdayDay ? String(guest.birthdayDay) : "",
  });
  const [optIn, setOptIn] = useState(guest.marketingOptIn);
  const [consentSource, setConsentSource] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setF((cur) => ({ ...cur, [k]: e.target.value }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (optIn && !guest.marketingOptIn && !consentSource.trim()) {
      return setMsg({ ok: false, text: "Say how they agreed to marketing (e.g. 'asked at the table')." });
    }
    setBusy(true);
    setMsg(null);
    const r = await saveGuest(
      guest.id,
      {
        firstName: f.firstName,
        lastName: f.lastName || null,
        email: f.email || null,
        phone: f.phone || null,
        notes: f.notes || null,
        allergies: f.allergies || null,
        tags: f.tags.split(",").map((t) => t.trim()).filter(Boolean),
        birthdayMonth: f.birthdayMonth ? Number(f.birthdayMonth) : null,
        birthdayDay: f.birthdayDay ? Number(f.birthdayDay) : null,
        ...(optIn !== guest.marketingOptIn ? { marketingOptIn: optIn } : {}),
      },
      consentSource,
    );
    setBusy(false);
    if (r.ok) {
      setMsg({ ok: true, text: "Saved" });
      router.refresh();
    } else setMsg({ ok: false, text: r.error });
  }

  return (
    <form className="box guest-edit" onSubmit={save}>
      <h2>Details</h2>
      <div className="row">
        <label>
          First name
          <input value={f.firstName} onChange={set("firstName")} required />
        </label>
        <label>
          Last name
          <input value={f.lastName} onChange={set("lastName")} />
        </label>
      </div>
      <label>
        Email
        <input type="email" value={f.email} onChange={set("email")} />
      </label>
      <label>
        Phone
        <input type="tel" value={f.phone} onChange={set("phone")} />
      </label>
      <label>
        Allergies &amp; dietary
        <input value={f.allergies} onChange={set("allergies")} placeholder="e.g. severe nut allergy" />
      </label>
      <div>
        <span className="lbl">Birthday</span>
        <div className="row">
          <select value={f.birthdayDay} onChange={set("birthdayDay")} aria-label="Birthday day">
            <option value="">Day</option>
            {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
          <select value={f.birthdayMonth} onChange={set("birthdayMonth")} aria-label="Birthday month">
            <option value="">Month</option>
            {MONTHS.map((m, i) => (
              <option key={m} value={i + 1}>
                {m}
              </option>
            ))}
          </select>
        </div>
      </div>
      <label>
        Tags (comma separated)
        <input value={f.tags} onChange={set("tags")} placeholder="vip, wine club, press" />
      </label>
      <label>
        Notes for the team
        <textarea rows={3} value={f.notes} onChange={set("notes")} placeholder="Likes the window table; partner is vegetarian" />
      </label>
      <fieldset className="consent">
        <legend>Marketing</legend>
        <label className="check">
          <input type="checkbox" checked={optIn} onChange={(e) => setOptIn(e.target.checked)} />
          Happy to get news and offers
        </label>
        {optIn && !guest.marketingOptIn && (
          <label>
            How did they agree?
            <input value={consentSource} onChange={(e) => setConsentSource(e.target.value)} placeholder="e.g. asked at the table, 3 Oct" />
          </label>
        )}
        <p className="small muted" style={{ margin: 0 }}>
          {guest.unsubscribedAt
            ? `Unsubscribed on ${guest.unsubscribedAt}. Only tick this if they've asked to be added back.`
            : guest.marketingOptIn
              ? `Agreed${guest.consentAt ? ` on ${guest.consentAt}` : ""}${guest.consentSource ? ` (${guest.consentSource})` : ""}.`
              : "Not opted in: they won't get marketing emails."}
        </p>
      </fieldset>
      {msg && (
        <p className={msg.ok ? "ok" : "error"} role={msg.ok ? "status" : "alert"} style={{ margin: 0 }}>
          {msg.text}
        </p>
      )}
      <button type="submit" className="primary" disabled={busy}>
        {busy ? "Saving…" : "Save"}
      </button>
    </form>
  );
}
