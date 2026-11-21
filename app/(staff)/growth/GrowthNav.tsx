"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

// The programme, in the order the engagement is worked: start it, see where the
// money is, model it, change things, keep the rhythm.
// Pages still being finished stay out of the menu until they ship.
const NEW_PAGES = false;
const GROUPS: { label: string; views: [string, string][] }[] = [
  { label: "", views: [["", "Overview"]] },
  ...(NEW_PAGES ? [{ label: "Start", views: [["/brief", "The plan"], ["/mobilisation", "Today\u2019s meeting"], ["/data-request", "Data request"]] as [string, string][] }] : []),
  { label: "Where the money is", views: [["/scoreboard", "Scoreboard"], ["/seat-hours", "Seat-hours"], ["/menu", "Menu"], ["/team", "Team"], ["/bookings", "Bookings"], ["/turnaways", "Turn-aways"]] },
  { label: "The model", views: [["/bridge", "Revenue model"], ["/bets", "Big bets"]] },
  { label: "Gains", views: [...(NEW_PAGES ? [["/playbooks", "Playbooks"] as [string, string]] : []), ["/gains", "Gains board"], ["/tests", "Tests"], ["/events", "Events"]] },
  { label: "Rhythm", views: [["/plan", "Actions"], ["/meetings", "Meetings"], ["/scorecard", "Scorecard"]] },
  { label: "Set-up", views: [["/data", "Load data"], ["/settings", "Settings"]] },
];
// Views whose figures follow the period selector.
const PERIOD_VIEWS = new Set(["", "/scoreboard", "/seat-hours", "/menu", "/team", "/bookings", "/bridge", "/events", "/turnaways", "/brief"]);

export default function GrowthNav({ slug }: { slug: string }) {
  const path = usePathname();
  const sp = useSearchParams();
  const router = useRouter();
  const base = `/growth/${slug}`;
  const current = path.startsWith(base) ? path.slice(base.length).replace(/\/$/, "") : "";
  const w = sp.get("w") ?? "12";
  const q = w === "12" ? "" : `?w=${w}`;
  return (
    <div className="gnav">
      {/* On a phone, one menu beats twenty tabs. */}
      <label className="gnav-menu">
        <span className="sr-only">Go to</span>
        <select value={current} onChange={(e) => router.push(`${base}${e.target.value}${q}`)}>
          {GROUPS.map((g) =>
            g.label ? (
              <optgroup key={g.label} label={g.label}>
                {g.views.map(([href, label]) => (<option key={href} value={href}>{label}</option>))}
              </optgroup>
            ) : (
              g.views.map(([href, label]) => (<option key={href} value={href}>{label}</option>))
            ),
          )}
        </select>
      </label>
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
            <Link key={v} href={`${path}${v === "12" ? "" : `?w=${v}`}`} aria-current={w === v ? "true" : undefined} scroll={false}>
              {label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
