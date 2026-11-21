"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

const VIEWS = [
  ["", "Scoreboard"], ["/seat-hours", "Seat-hours"], ["/menu", "Menu"], ["/team", "Team"], ["/bookings", "Bookings"], ["/gains", "Gains board"],
  ["/tests", "Tests"], ["/scorecard", "Scorecard"], ["/plan", "Plan"], ["/bets", "Big bets"], ["/bridge", "Bridge"], ["/events", "Events"],
  ["/turnaways", "Turn-aways"], ["/meetings", "Meetings"], ["/data", "Data"], ["/settings", "Settings"],
] as const;
// Views whose figures follow the period selector.
const PERIOD_VIEWS = new Set(["", "/seat-hours", "/menu", "/team", "/bookings", "/bridge", "/events"]);

export default function GrowthNav({ slug }: { slug: string }) {
  const path = usePathname();
  const sp = useSearchParams();
  const base = `/growth/${slug}`;
  const current = path.startsWith(base) ? path.slice(base.length).replace(/\/$/, "") : "";
  const w = sp.get("w") ?? "12";
  const q = w === "12" ? "" : `?w=${w}`;
  return (
    <div className="gnav">
      <nav className="gnav-links" aria-label="Growth views">
        {VIEWS.map(([href, label]) => (
          <Link key={href} href={`${base}${href}${q}`} aria-current={current === href ? "page" : undefined}>
            {label}
          </Link>
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
