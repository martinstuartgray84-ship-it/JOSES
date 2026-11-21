import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/src/server/db";
import { listSites } from "@/src/server/manage";
import { requireStaff } from "@/src/server/staff";
import "../dashboard/dashboard.css";
import "../growth/growth.css";

export const metadata: Metadata = { title: "Platform", robots: { index: false } };
export const dynamic = "force-dynamic";

type Mod = { name: string; what: string; status: "Working" | "Prototype" | "Planned"; links: [string, string][] };

export default async function Suite() {
  await requireStaff("/suite");
  const sites = await listSites(db(), process.env.COMPANY_SLUG);
  const s = sites[0]?.slug ?? "";
  const stages: { title: string; lead: string; mods: Mod[] }[] = [
    {
      title: "1. See where the money is", lead: "Load what the till and booking system already hold; show what each hour, dish and seat earns.",
      mods: [
        { name: "Data in", what: "Three CSV exports with column matching, validation report, safe re-loads.", status: "Working", links: [["Data", `/growth/${s}/data`]] },
        { name: "Scoreboard and analytics", what: "Nine headline numbers, seat-hours, menu engineering, team, bookings, turn-aways.", status: "Working", links: [["Scoreboard", `/growth/${s}/scoreboard`], ["Seat-hours", `/growth/${s}/seat-hours`], ["Menu", `/growth/${s}/menu`]] },
        { name: "Direct till and booking connectors", what: "No exports: read sales and reservations live from the venue's own systems.", status: "Planned", links: [] },
      ],
    },
    {
      title: "2. Decide what to change", lead: "Two tracks: a few big bets on unsold hours, many small tested gains in every hour.",
      mods: [
        { name: "Big bets", what: "Charters with sponsor, three gates, measures and a stop rule.", status: "Working", links: [["Big bets", `/growth/${s}/bets`], ["Bridge", `/growth/${s}/bridge`]] },
        { name: "Ideas, tests and gains", what: "Idea → test with a guest guardrail → measured readout → banked gain, re-checked at 90 days.", status: "Working", links: [["Gains board", `/growth/${s}/gains`], ["Tests", `/growth/${s}/tests`]] },
        { name: "Events and hire", what: "Enquiry log, true net gain per event, minimum-spend grid from normal trade.", status: "Working", links: [["Events", `/growth/${s}/events`]] },
        { name: "Assistant", what: "Drafts the weekly narrative and proposes the next test from the venue's own numbers.", status: "Planned", links: [] },
      ],
    },
    {
      title: "3. Run it every week", lead: "The rhythm that makes gains stick: actions, meetings and one scorecard everyone reads.",
      mods: [
        { name: "Plan", what: "Actions by owner, decisions, first-30-days path.", status: "Working", links: [["Plan", `/growth/${s}/plan`], ["Meetings", `/growth/${s}/meetings`]] },
        { name: "Weekly scorecard", what: "Built each Monday for the week before and emailed to managers.", status: "Working", links: [["Scorecard", `/growth/${s}/scorecard`]] },
      ],
    },
    {
      title: "4. Operate the venue", lead: "The operating suite. With it, the programme reads live data and changes show up the same night.",
      mods: [
        { name: "Bookings and diary", what: "Commission-free online booking, diary, floor plan, pacing, reminders.", status: "Prototype", links: [["Diary", `/diary/${s}`], ["Booking page", "/book"]] },
        { name: "Till, kitchen and bar", what: "Orders, courses, station screens with cook-to-sync timing, payments.", status: "Prototype", links: [["Till", `/pos/${s}`], ["Kitchen & bar", `/kds/${s}`]] },
        { name: "Floor and ops", what: "Live table coaching, covers forecast, staffing, prep and batching.", status: "Prototype", links: [["Floor", `/floor/${s}`], ["Ops", `/ops/${s}`]] },
        { name: "Guests and marketing", what: "One guest record across sites, segments, campaigns, win-back automations.", status: "Prototype", links: [["Guests", "/guests"], ["Marketing", "/marketing"]] },
      ],
    },
    {
      title: "5. Scale beyond one site", lead: "What turns a proven method into a product other restaurants buy.",
      mods: [
        { name: "Accounts and roles", what: "Per-person sign-in; owner, manager, captain and viewer roles per venue. Data separation between organisations is already enforced and tested in the database.", status: "Planned", links: [] },
        { name: "Benchmarks", what: "How a venue's numbers compare with others like it, once enough are loaded.", status: "Planned", links: [] },
        { name: "Playbook library", what: "Tests that worked at site one, packaged with scripts and expected lift for the next venue.", status: "Planned", links: [] },
      ],
    },
  ];
  const tone = { Working: "good", Prototype: "info", Planned: "" } as const;
  return (
    <main className="page dash growth">
      <header className="ghead">
        <h1>The platform</h1>
        <p className="muted">What restaurants will run once the method is proven at Jose&rsquo;s. This is the prototype, built alongside the engagement: open any module to use it, and see below what works today and what comes next.</p>
      </header>
      <section className="box">
        <h2>The path</h2>
        <ol className="gsteps">
          <li><strong>Prove it.</strong> Run the programme at site one until measured, banked gains show the profit lift. <Link href={`/growth/${s}`}>Programme overview</Link></li>
          <li><strong>Package it.</strong> Turn the tests that worked into a playbook, and the manual steps into software.</li>
          <li><strong>Sell it.</strong> Offer it to owners of one to five full-service restaurants or bars.</li>
        </ol>
      </section>
      {stages.map((st) => (
        <section key={st.title}>
          <h2>{st.title}</h2>
          <p className="muted" style={{ margin: "0 0 10px" }}>{st.lead}</p>
          <div className="gmods">
            {st.mods.map((m) => (
              <div key={m.name} className="gmod">
                <h3>{m.name} <span className={`chip ${tone[m.status]}`}>{m.status}</span></h3>
                <p className="small">{m.what}</p>
                {m.links.length > 0 && <p className="small">{m.links.map(([label, href], i) => (<span key={href}>{i > 0 && " · "}<Link href={href}>{label}</Link></span>))}</p>}
              </div>
            ))}
          </div>
        </section>
      ))}
      <section className="box">
        <h2>Commercial hypotheses</h2>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Offer</th><th>Price</th><th>What the buyer gets</th></tr></thead>
            <tbody>
              <tr><td>Diagnostic</td><td className="num">£4,000 fixed</td><td>Data loaded, baseline, where the money is, a first bridge.</td></tr>
              <tr><td>Programme</td><td className="num">£2,500 a month + 10% of measured extra gross profit</td><td>The full programme run with their team, on the application.</td></tr>
              <tr><td>Application only</td><td className="num">£199 a site a month</td><td>The software, self-run.</td></tr>
            </tbody>
          </table>
        </div>
        <p className="gnote">Buyer: owner or operations lead of one to five full-service restaurants or bars, £500k to £3m sales a site. None of this is tested yet: the first site is the proof.</p>
      </section>
    </main>
  );
}
