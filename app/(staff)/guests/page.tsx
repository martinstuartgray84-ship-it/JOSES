import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/src/server/db";
import { listGuests, type GuestSort } from "@/src/server/crm";
import { staffCompany } from "@/src/server/guard";
import { requireStaff } from "@/src/server/staff";
import { describeSegment, PRESETS } from "@/src/marketing/segments";
import { formatMoney } from "@/src/pos/totals";
import GuestSearch from "./GuestSearch";
import "./guests.css";

export const metadata: Metadata = { title: "Guests", robots: { index: false } };
export const dynamic = "force-dynamic";

const PAGE = 50;
const SORTS: { key: GuestSort; label: string }[] = [
  { key: "recent", label: "Last visit" },
  { key: "visits", label: "Visits" },
  { key: "spend", label: "Spend" },
  { key: "name", label: "Name" },
];

const ago = (d: Date | null) => {
  if (!d) return "never";
  const days = Math.floor((Date.now() - new Date(d).getTime()) / 86_400_000);
  if (days < 1) return "today";
  if (days < 2) return "yesterday";
  if (days < 60) return `${days} days ago`;
  return `${Math.round(days / 30)} months ago`;
};

export default async function GuestsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; seg?: string; sort?: string; page?: string }>;
}) {
  await requireStaff("/guests");
  const sp = await searchParams;
  const company = await staffCompany();
  const preset = PRESETS.find((p) => p.key === sp.seg) ?? PRESETS[0]!;
  const sort = (SORTS.find((s) => s.key === sp.sort)?.key ?? "recent") as GuestSort;
  const page = Math.max(1, Number(sp.page) || 1);
  const { rows, total, mailable } = await listGuests(db(), company.id, {
    q: sp.q,
    segment: preset.segment,
    sort,
    limit: PAGE,
    offset: (page - 1) * PAGE,
  });
  const link = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { q: sp.q, seg: preset.key === "all" ? undefined : preset.key, sort: sort === "recent" ? undefined : sort, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const s = p.toString();
    return `/guests${s ? `?${s}` : ""}`;
  };

  return (
    <main className="page guests-page">
      <div className="page-head">
        <div>
          <h1>Guests</h1>
          <p className="muted small" style={{ margin: 0 }}>
            {total.toLocaleString("en-GB")} guest{total === 1 ? "" : "s"} · {mailable.toLocaleString("en-GB")} can be emailed
          </p>
        </div>
        <GuestSearch initial={sp.q ?? ""} />
      </div>

      <nav className="seg-list" aria-label="Segments">
        {PRESETS.map((p) => (
          <Link key={p.key} href={link({ seg: p.key === "all" ? undefined : p.key, page: undefined })} className={p.key === preset.key ? "on" : ""}>
            {p.label}
          </Link>
        ))}
      </nav>
      <p className="muted small" style={{ margin: 0 }}>
        {preset.why} {preset.key !== "all" && <>({describeSegment(preset.segment)}.)</>}{" "}
        {preset.key !== "all" && preset.key !== "no-shows" && (
          <Link href={`/marketing?seg=${preset.key}`}>Email this group →</Link>
        )}
      </p>

      <section className="box">
        <div className="tbl-wrap">
          <table className="tbl guest-tbl">
            <thead>
              <tr>
                <th>Guest</th>
                {SORTS.slice(0, 3).map((s) => (
                  <th key={s.key} className={s.key === "recent" ? "" : "right"}>
                    <Link href={link({ sort: s.key === "recent" ? undefined : s.key, page: undefined })} className={sort === s.key ? "sorted" : ""}>
                      {s.label}
                      {sort === s.key ? " ↓" : ""}
                    </Link>
                  </th>
                ))}
                <th>Contact</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((g) => (
                <tr key={g.id}>
                  <td>
                    <Link href={`/guests/${g.id}`} className="guest-name">
                      {g.name}
                    </Link>
                    <div className="item-tags">
                      {g.visits >= 5 && <span className="chip good">★ regular</span>}
                      {g.noShows > 0 && <span className="chip bad">{g.noShows} no-show{g.noShows > 1 ? "s" : ""}</span>}
                      {g.tags.map((t) => (
                        <span key={t} className="chip">
                          {t}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td>{ago(g.lastVisit)}</td>
                  <td className="right num">{g.visits}</td>
                  <td className="right num">{formatMoney(g.spend)}</td>
                  <td className="small">
                    {g.email ?? <span className="muted">no email</span>}
                    {g.phone && <div className="muted">{g.phone}</div>}
                    {!g.mailable && g.email && <div className="muted">no marketing</div>}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted">
                    No guests match.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {total > PAGE && (
          <div className="pager">
            {page > 1 ? <Link href={link({ page: String(page - 1) })}>‹ Previous</Link> : <span />}
            <span className="muted small">
              {(page - 1) * PAGE + 1}–{Math.min(page * PAGE, total)} of {total}
            </span>
            {page * PAGE < total ? <Link href={link({ page: String(page + 1) })}>Next ›</Link> : <span />}
          </div>
        )}
      </section>
    </main>
  );
}
