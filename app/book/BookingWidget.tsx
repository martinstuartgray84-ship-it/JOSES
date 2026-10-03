"use client";

import { useEffect, useMemo, useState } from "react";
import type { PublicSite } from "@/src/server/manage";
import {
  formatTime,
  type ApiError,
  type AvailabilityResponse,
  type BookingCreatedResponse,
  type PublicSlot,
} from "@/src/lib/api";

const MAX_ONLINE_PARTY = 8;

/** Today's date in the site's timezone, as YYYY-MM-DD. */
function todayIn(timezone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date());
}

function addDays(date: string, days: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const longDate = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });

type Step = "search" | "details" | "done";

export default function BookingWidget({ sites, fixedSite }: { sites: PublicSite[]; fixedSite?: string }) {
  const [siteSlug, setSiteSlug] = useState(fixedSite ?? (sites.length === 1 ? sites[0]!.slug : ""));
  const site = sites.find((s) => s.slug === siteSlug);
  const today = todayIn(site?.timezone ?? "Europe/London");

  const [covers, setCovers] = useState(2);
  const [date, setDate] = useState(today);
  const [slots, setSlots] = useState<PublicSlot[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<PublicSlot | null>(null);
  const [step, setStep] = useState<Step>("search");
  const [confirmed, setConfirmed] = useState<BookingCreatedResponse | null>(null);
  const [refresh, setRefresh] = useState(0);
  // Shown after a chosen time was taken by someone else; survives the refetch.
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!siteSlug || !date) return;
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    setChosen(null);
    fetch(`/api/availability?${new URLSearchParams({ site: siteSlug, date, covers: String(covers) })}`, {
      signal: ctrl.signal,
    })
      .then(async (r) => {
        const body = (await r.json()) as AvailabilityResponse | ApiError;
        if (!r.ok || "error" in body) throw new Error("error" in body ? body.error : "Something went wrong");
        setSlots(body.slots);
      })
      .catch((e: Error) => {
        if (e.name !== "AbortError") {
          setSlots(null);
          setError(e.message);
        }
      })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [siteSlug, date, covers, refresh]);

  const byService = useMemo(() => {
    const groups = new Map<string, PublicSlot[]>();
    for (const s of slots ?? []) {
      const list = groups.get(s.serviceName) ?? [];
      list.push(s);
      groups.set(s.serviceName, list);
    }
    return [...groups];
  }, [slots]);

  if (step === "done" && confirmed && site && chosen) {
    return (
      <section className="card" aria-live="polite">
        <h2>You&rsquo;re booked</h2>
        <p className="summary">
          {site.name} · {longDate(date)} at {formatTime(chosen.time)} · {covers} {covers === 1 ? "guest" : "guests"}
        </p>
        <p>We&rsquo;ve saved your booking. You can view or cancel it any time from this link:</p>
        <p>
          <a href={`/manage/${confirmed.manageToken}`}>Manage your booking</a>
        </p>
      </section>
    );
  }

  if (step === "details" && site && chosen) {
    return (
      <DetailsForm
        site={site}
        date={date}
        covers={covers}
        slot={chosen}
        onBack={() => setStep("search")}
        onBooked={(b) => {
          setConfirmed(b);
          setStep("done");
        }}
        onGone={(message) => {
          setStep("search");
          setNotice(message);
          setRefresh((n) => n + 1); // refetch so the time that just went disappears
        }}
      />
    );
  }

  return (
    <section className="card">
      <h2>Book a table</h2>

      {!fixedSite && sites.length > 1 && (
        <fieldset className="sites">
          <legend>Which restaurant?</legend>
          {sites.map((s) => (
            <label key={s.slug} className={`choice ${s.slug === siteSlug ? "on" : ""}`}>
              <input
                type="radio"
                name="site"
                value={s.slug}
                checked={s.slug === siteSlug}
                onChange={() => {
                  setNotice(null);
                  setSiteSlug(s.slug);
                }}
              />
              {s.name}
            </label>
          ))}
        </fieldset>
      )}

      <div className="row">
        <label>
          Guests
          <select value={covers} onChange={(e) => {
              setNotice(null);
              setCovers(Number(e.target.value));
            }}>
            {Array.from({ length: MAX_ONLINE_PARTY }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n} {n === 1 ? "guest" : "guests"}
              </option>
            ))}
          </select>
        </label>
        <label>
          Date
          <input
            type="date"
            value={date}
            min={today}
            max={site ? addDays(today, site.bookingWindowDays) : undefined}
            onChange={(e) => {
              if (!e.target.value) return;
              setNotice(null);
              setDate(e.target.value);
            }}
          />
        </label>
      </div>
      <p className="hint">More than {MAX_ONLINE_PARTY}? Give us a call and we&rsquo;ll sort it.</p>

      {(notice || error) && (
        <p className="error" role="alert">
          {notice ?? error}
        </p>
      )}

      {siteSlug ? (
        <div className="times" aria-busy={loading}>
          {loading && !slots && <p className="hint">Checking tables…</p>}
          {slots && slots.length === 0 && !loading && (
            <p className="hint">Nothing free on {longDate(date)}. Try another day or a different party size.</p>
          )}
          {byService.map(([name, list]) => (
            <div key={name} className="service">
              <h3>{name}</h3>
              <div className="grid">
                {list.map((s) => (
                  <button
                    key={`${s.serviceId}-${s.time}`}
                    type="button"
                    className={`time ${chosen === s ? "on" : ""}`}
                    onClick={() => {
                      setNotice(null);
                      setChosen(s);
                      setStep("details");
                    }}
                  >
                    {formatTime(s.time)}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="hint">Choose a restaurant to see times.</p>
      )}
    </section>
  );
}

function DetailsForm(props: {
  site: PublicSite;
  date: string;
  covers: number;
  slot: PublicSlot;
  onBack: () => void;
  onBooked: (b: BookingCreatedResponse) => void;
  onGone: (message: string) => void;
}) {
  const { site, date, covers, slot } = props;
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const text = (k: string) => (String(f.get(k) ?? "").trim() || undefined);
    setSubmitting(true);
    setError(null);
    try {
      const r = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          site: site.slug,
          date,
          serviceId: slot.serviceId,
          time: slot.time,
          covers,
          guest: {
            firstName: text("firstName"),
            lastName: text("lastName"),
            email: text("email"),
            phone: text("phone"),
            marketingOptIn: f.get("marketing") === "on",
          },
          specialRequests: text("requests"),
        }),
      });
      const body = (await r.json()) as BookingCreatedResponse | ApiError;
      if (r.status === 409) return props.onGone("error" in body ? body.error : "That time has gone");
      if (!r.ok || "error" in body) throw new Error("error" in body ? body.error : "Something went wrong");
      props.onBooked(body);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="card" onSubmit={submit}>
      <button type="button" className="link" onClick={props.onBack}>
        ← Change time
      </button>
      <h2>Your details</h2>
      <p className="summary">
        {site.name} · {longDate(date)} at {formatTime(slot.time)} · {covers} {covers === 1 ? "guest" : "guests"}
      </p>
      <div className="row">
        <label>
          First name
          <input name="firstName" required autoComplete="given-name" maxLength={100} />
        </label>
        <label>
          Last name
          <input name="lastName" autoComplete="family-name" maxLength={100} />
        </label>
      </div>
      <label>
        Email
        <input name="email" type="email" required autoComplete="email" maxLength={254} />
      </label>
      <label>
        Mobile
        <input name="phone" type="tel" autoComplete="tel" placeholder="So we can text if anything changes" />
      </label>
      <label>
        Anything we should know?
        <textarea name="requests" rows={3} maxLength={500} placeholder="Allergies, occasions, high chair…" />
      </label>
      <label className="check">
        <input type="checkbox" name="marketing" /> Send me news and offers
      </label>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="primary" disabled={submitting}>
        {submitting ? "Booking…" : "Confirm booking"}
      </button>
    </form>
  );
}
