import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/src/server/db";
import { isDemo } from "@/src/server/demo";
import { getSettings, programmeSites } from "@/src/server/growth";
import { listActions, listBets } from "@/src/server/growth-office";
import { programme, venueToday } from "@/src/server/growth-programme";
import { requireStaff } from "@/src/server/staff";
import { fmt } from "@/src/growth/engine";
import { FIRST_30_DAYS } from "@/src/growth/starter";
import "./dashboard/dashboard.css";
import "./growth/growth.css";
import "./home.css";

export const metadata: Metadata = { title: "Home", robots: { index: false } };
export const dynamic = "force-dynamic";

// Pages still being finished are linked once they ship.
const NEW_PAGES = false;

// The front door: two sides. The programme is the engagement at the first
// site; the product is what a restaurant runs on. Guests book at /book.
export default async function Home() {
  await requireStaff("/");
  const sql = db();
  const site = (await programmeSites(sql, process.env.COMPANY_SLUG))[0];
  if (!site) return (<main className="page"><p className="muted">No sites yet.</p></main>);
  const base = `/growth/${site.slug}`;
  const [settings, p, actions, bets, today] = await Promise.all([getSettings(sql, site.id), programme(sql, site.id), listActions(sql, site.id), listBets(sql, site.id), venueToday(sql, site.id)]);
  const open = actions.filter((a) => a.status === "open");
  const week = FIRST_30_DAYS.find((w) => today >= w.from && today <= w.to);
  const kickoff = today <= FIRST_30_DAYS[0]!.to;
  return (
    <main className="page dash growth home">
      <header className="home-head">
        <p className="home-kicker">{site.name}</p>
        <h1>{settings.programmeName}</h1>
        <p className="home-lead">Big bets on new hours, marginal gains in every hour. We plan it, model it and prove it at {site.name}; what works becomes the product other restaurants run on.</p>
      </header>

      {kickoff && (
        <section className="box home-today">
          <div>
            <h2>Today: the mobilisation meeting</h2>
            <p>Sixty minutes with the owner and managers. Leave with named owners, the data requested and three small tests agreed.</p>
          </div>
          <div className="btn-row">
            {NEW_PAGES ? (
              <>
                <Link className="gbtn primary" href={`${base}/mobilisation`}>Run the meeting</Link>
                <Link className="gbtn" href={`${base}/brief`}>The plan on a page</Link>
                <Link className="gbtn" href={`${base}/data-request`}>Data request</Link>
              </>
            ) : (
              <>
                <Link className="gbtn primary" href={`${base}/meetings?new=mobilisation#new`}>Start the meeting notes</Link>
                <Link className="gbtn" href={`${base}/plan`}>Actions and decisions</Link>
                <Link className="gbtn" href={`${base}/gains`}>Capture ideas</Link>
              </>
            )}
          </div>
        </section>
      )}

      <div className="home-doors">
        <section className="box home-door prog">
          <p className="home-tag">The programme</p>
          <h2>Grow this restaurant</h2>
          <p>The working space for the engagement: where the money is, the revenue model, the big bets, the tests the team runs, and the weekly rhythm that makes gains stick.</p>
          <dl className="home-stats">
            <div><dt>Gains banked</dt><dd className="num">{fmt("money0", p.total)}<span> a year</span></dd></div>
            <div><dt>Tests live</dt><dd className="num">{p.tests.filter((t) => t.status === "live").length}</dd></div>
            <div><dt>Big bets</dt><dd className="num">{bets.filter((b) => b.status === "active").length}</dd></div>
            <div><dt>Actions open</dt><dd className="num">{open.length}{open.some((a) => a.overdue) && <span className="bad-text"> · {open.filter((a) => a.overdue).length} overdue</span>}</dd></div>
          </dl>
          {week && <p className="small muted">First 30 days, {week.week.toLowerCase()}: {week.focus.charAt(0).toLowerCase() + week.focus.slice(1)}.</p>}
          <div className="btn-row">
            <Link className="gbtn primary" href={base}>Open the programme</Link>
            <Link className="gbtn" href={`${base}/scoreboard`}>Scoreboard</Link>
            <Link className="gbtn" href={`${base}/gains`}>Gains board</Link>
            <Link className="gbtn" href={`${base}/plan`}>Actions</Link>
          </div>
        </section>

        <section className="box home-door prod">
          <p className="home-tag">The product</p>
          <h2>Run the restaurant</h2>
          <p>The platform a restaurant runs on day to day: bookings, till, kitchen and bar screens, guests and marketing. A working prototype, built alongside the programme and sold to other restaurants once the method is proven here.</p>
          <ul className="home-mods">
            <li><Link href={`/diary/${site.slug}`}>Bookings and diary</Link></li>
            <li><Link href={`/pos/${site.slug}`}>Till</Link></li>
            <li><Link href={`/kds/${site.slug}`}>Kitchen and bar screens</Link></li>
            <li><Link href={`/floor/${site.slug}`}>Floor</Link></li>
            <li><Link href="/guests">Guests</Link></li>
            <li><Link href="/dashboard">Dashboard</Link></li>
          </ul>
          <div className="btn-row">
            <Link className="gbtn primary" href="/suite">Open the product</Link>
            <Link className="gbtn" href="/book">What guests see</Link>
          </div>
        </section>
      </div>

      {isDemo() && (
        <p className="small muted home-note">
          This is a demonstration: every sales figure is invented sample data for a 60-seat restaurant, not {site.name}&rsquo;s own numbers. What you enter in the programme is kept in this browser; take a backup from <Link href={`${base}/settings`}>Settings</Link> to move it.
        </p>
      )}
    </main>
  );
}
