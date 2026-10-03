"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { StaffMember } from "@/src/server/orders";
import { pinSignIn } from "../actions";

export default function PinPad({ siteSlug, staff }: { siteSlug: string; staff: StaffMember[] }) {
  const router = useRouter();
  const [who, setWho] = useState<StaffMember | null>(staff.length === 1 ? staff[0]! : null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(code: string) {
    if (!who) return;
    setBusy(true);
    setError(null);
    const r = await pinSignIn(siteSlug, who.id, code);
    setBusy(false);
    if (r.ok) router.refresh();
    else {
      setError(r.error);
      setPin("");
    }
  }

  const press = (d: string) => {
    if (busy) return;
    const next = (pin + d).slice(0, 6);
    setPin(next);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!who) return;
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === "Backspace") setPin((p) => p.slice(0, -1));
      else if (e.key === "Enter" && pin.length >= 4) submit(pin);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (staff.length === 0) {
    return (
      <main className="page">
        <section className="box pin-box">
          <h1>No till users yet</h1>
          <p className="muted">
            Add staff with a PIN before using the till (see the README: <code>staff_members</code> and{" "}
            <code>set_staff_pin</code>).
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="page">
      <section className="box pin-box">
        {!who ? (
          <>
            <h1>Who&rsquo;s on the till?</h1>
            <div className="pin-staff">
              {staff.map((s) => (
                <button key={s.id} type="button" onClick={() => setWho(s)}>
                  <strong>{s.name}</strong>
                  <span className="muted small">{s.role}</span>
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <h1>Hi {who.name}</h1>
            <p className="muted" style={{ margin: 0 }}>
              Enter your PIN
            </p>
            <div className="pin-dots" aria-label={`${pin.length} digits entered`}>
              {Array.from({ length: Math.max(4, pin.length) }, (_, i) => (
                <span key={i} className={i < pin.length ? "on" : ""} />
              ))}
            </div>
            {error && (
              <p className="error" role="alert" style={{ margin: 0 }}>
                {error}
              </p>
            )}
            <div className="keypad">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
                <button key={d} type="button" onClick={() => press(d)} disabled={busy}>
                  {d}
                </button>
              ))}
              <button type="button" className="ghost" onClick={() => setPin((p) => p.slice(0, -1))} aria-label="Delete">
                ⌫
              </button>
              <button type="button" onClick={() => press("0")} disabled={busy}>
                0
              </button>
              <button type="button" className="primary" onClick={() => submit(pin)} disabled={busy || pin.length < 4} aria-label="Sign in">
                ✓
              </button>
            </div>
            {staff.length > 1 && (
              <button
                type="button"
                className="link"
                onClick={() => {
                  setWho(null);
                  setPin("");
                  setError(null);
                }}
              >
                Not {who.name}?
              </button>
            )}
          </>
        )}
      </section>
    </main>
  );
}
