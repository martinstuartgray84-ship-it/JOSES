"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

// The programme, in the order it is worked: see where the money is, choose what to change, run it.
const GROUPS: { label: string; views: [string, string][] }[] = [
  { label: "", views: [["", "Overview"]] },
  { label: "Analytics", views: [["/scoreboard", "Scoreboard"], ["/seat-hours", "Seat-hours"], ["/menu", "Menu"], ["/team", "Team"], ["/bookings", "Bookings"], ["/turnaways", "Turn-aways"]] },
  { label: "Initiatives", views: [["/bets", "Big bets"], ["/gains", "Gains board"], ["/tests", "Tests"], ["/events", "Events"], ["/bridge", "Bridge"]] },
  { label: "Running it", views: [["/plan", "Plan"], ["/meetings", "Meetings"], ["/scorecard", "Scorecard"]] },
  { label: "Set-up", views: [["/data", "Data"], ["/settings", "Settings"]] },
];
// Views whose figures follow the period selector.
const PERIOD_VIEWS = new Set(["", "/scoreboard", "/seat-hours", "/menu", "/team", "/bookings", "/bridge", "/events", "/turnaways"]);

export default function GrowthNav({ slug }: { slug: string }) {
  const path = usePathname();
  const sp = useSearchParams();
  const base = `/growth/${slug}`;
  const current = path.startsWith(base) ? path.slice(base.length).replace(/\/$/, "") : "";
  const w = sp.get("w") ?? "12";
  const q = w === "12" ? "" : `?w=${w}`;
  return (
    <div className="gnav">
      <nav className="gnav-links" aria-label="Programme">
        {GROUPS.map((g) => (
          <div key={g.label || "home"} className="gnav-group">
            {g.label && <span className="gnav-label">{g.label}</span>}
            {g.views.map(([href, label]) => (
              <Link key={href} href={`${base}${href}${q}`} aria-current={current === href ? "page" : undefined}>
                {label}
              </Link>
            ))}
          </div>
        ))}
      </nav>
      {PERIOD_VIEWS.has(current) && (
        <div className="seg gnav-period" role="group" aria-label="Period">
          {([["4", "4 weeks"], ["12", "12 weeks"], ["0", "All"]] as const).map(([v, label]) => (
            <Link key={v} href={`${path}${v === "12" ? "" : `?w=${v}`}`} aria-pressed={w === v} scroll={false}>
              {label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
