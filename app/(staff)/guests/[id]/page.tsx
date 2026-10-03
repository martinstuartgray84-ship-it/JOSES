import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/src/server/db";
import { guestProfile } from "@/src/server/crm";
import { staffCompany } from "@/src/server/guard";
import { requireStaff } from "@/src/server/staff";
import { formatMoney } from "@/src/pos/totals";
import GuestEditor from "./GuestEditor";
import "../guests.css";

export const metadata: Metadata = { title: "Guest", robots: { index: false } };
export const dynamic = "force-dynamic";

const date = (d: Date | null) =>
  d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" }) : "–";
const STATUS: Record<string, string> = {
  paid: "Visited",
  completed: "Visited",
  confirmed: "Booked",
  pending: "Pending",
  seated: "In now",
  cancelled: "Cancelled",
  no_show: "No-show",
};

export default async function GuestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireStaff(`/guests/${id}`);
  const company = await staffCompany();
  const p = await guestProfile(db(), company.id, id);
  if (!p) notFound();
  const s = p.stats;
  const name = [p.firstName, p.lastName].filter(Boolean).join(" ");
  const food = p.favourites.filter((f) => !f.drink).slice(0, 5);
  const drinks = p.favourites.filter((f) => f.drink).slice(0, 3);

  return (
    <main className="page guest-page">
      <p className="small" style={{ margin: 0 }}>
        <Link href="/guests">‹ Guests</Link>
      </p>
      <div className="page-head">
        <div>
          <h1>
            {name}{" "}
            {s.visits >= 5 && <span className="chip good">★ regular</span>}{" "}
            {s.noShows > 0 && <span className="chip bad">{s.noShows} no-show{s.noShows > 1 ? "s" : ""}</span>}
          </h1>
          <p className="muted small" style={{ margin: 0 }}>
            Guest since {date(p.createdAt)}
            {p.sites.length > 0 && ` · ${p.sites.map((x) => `${x.name} (${x.visits})`).join(", ")}`}
          </p>
        </div>
      </div>

      {p.allergies && <div className="allergy-banner">⚠ Allergies: {p.allergies}</div>}

      <section className="guest-stats">
        <div className="stat-tile">
          <span className="st-label">Visits</span>
          <span className="st-value num">{s.visits}</span>
          {s.avgGapDays !== null && <span className="st-hint muted">{s.avgGapDays <= 1 ? "about every day" : `about every ${s.avgGapDays} days`}</span>}
        </div>
        <div className="stat-tile">
          <span className="st-label">Total spend</span>
          <span className="st-value num">{formatMoney(s.spend)}</span>
          <span className="st-hint muted">{formatMoney(s.avgSpend)} a visit · {formatMoney(s.avgPerHead)} a head</span>
        </div>
        <div className="stat-tile">
          <span className="st-label">Last visit</span>
          <span className="st-value">{date(s.lastVisit)}</span>
          <span className="st-hint muted">first {date(s.firstVisit)}</span>
        </div>
        <div className="stat-tile">
          <span className="st-label">Reliability</span>
          <span className="st-value num">{s.noShows === 0 ? "Good" : `${s.noShows} no-show${s.noShows > 1 ? "s" : ""}`}</span>
          <span className="st-hint muted">{s.cancellations} cancellation{s.cancellations === 1 ? "" : "s"}</span>
        </div>
      </section>

      <div className="guest-cols">
        <div className="guest-main">
          <section className="box">
            <h2>Usually has</h2>
            {food.length + drinks.length === 0 ? (
              <p className="muted">Nothing on record yet.</p>
            ) : (
              <ul className="fav-list">
                {food.map((f) => (
                  <li key={f.name}>
                    <span>{f.name}</span>
                    <span className="muted num">×{f.count}</span>
                  </li>
                ))}
                {drinks.map((f) => (
                  <li key={f.name}>
                    <span>🍷 {f.name}</span>
                    <span className="muted num">×{f.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="box">
            <h2>History</h2>
            {p.timeline.length === 0 ? (
              <p className="muted">No visits or bookings yet.</p>
            ) : (
              <ul className="timeline-list">
                {p.timeline.map((t) => (
                  <li key={t.kind + t.id}>
                    <span className="num">{date(t.at)}</span>
                    <span>
                      {t.site} · {t.covers} guest{t.covers === 1 ? "" : "s"}
                    </span>
                    <span className={`chip ${t.status === "no_show" ? "bad" : t.status === "cancelled" ? "" : t.kind === "check" ? "good" : "info"}`}>
                      {STATUS[t.status] ?? t.status}
                    </span>
                    <span className="right num">{t.total !== null ? formatMoney(t.total) : ""}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="box">
            <h2>Messages</h2>
            {p.messages.length === 0 ? (
              <p className="muted">No marketing emails yet.</p>
            ) : (
              <ul className="timeline-list">
                {p.messages.map((m, i) => (
                  <li key={i}>
                    <span className="num">{date(m.sentAt)}</span>
                    <span>{m.subject}</span>
                    <span className="chip">{m.source}</span>
                    <span className="right small muted">{m.openedAt ? "opened" : ""}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <GuestEditor
          guest={{
            id: p.id,
            firstName: p.firstName,
            lastName: p.lastName,
            email: p.email,
            phone: p.phone,
            notes: p.notes,
            tags: p.tags,
            allergies: p.allergies,
            birthdayMonth: p.birthdayMonth,
            birthdayDay: p.birthdayDay,
            marketingOptIn: p.marketingOptIn,
            consentAt: p.consentAt ? date(p.consentAt) : null,
            consentSource: p.consentSource,
            unsubscribedAt: p.unsubscribedAt ? date(p.unsubscribedAt) : null,
          }}
        />
      </div>
    </main>
  );
}
