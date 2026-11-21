"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

// Two layers. The app is the engagement workspace: the programme run with the
// first restaurant. Inside it sits the platform: the product restaurants will run.
// Platform modules that are per site: /<section>/<site>/...
const PLATFORM_SITE = [
  { key: "diary", label: "Bookings and diary" },
  { key: "pos", label: "Till" },
  { key: "floor", label: "Floor" },
  { key: "ops", label: "Ops" },
  { key: "kds", label: "Kitchen & bar" },
  { key: "menu", label: "Menu" },
] as const;
// Company-wide modules.
const PLATFORM_COMPANY = [
  { key: "dashboard", label: "Dashboard" },
  { key: "guests", label: "Guests" },
  { key: "marketing", label: "Marketing" },
] as const;

export default function StaffNav({ sites }: { sites: { slug: string; name: string }[] }) {
  const path = usePathname();
  const router = useRouter();
  const [, section, maybeSite] = path.split("/");
  const site = sites.find((s) => s.slug === maybeSite)?.slug ?? sites[0]?.slug ?? "";
  const inModule = PLATFORM_SITE.some((s) => s.key === section) || PLATFORM_COMPANY.some((s) => s.key === section);
  const inPlatform = inModule || section === "suite";
  const siteSection = section === "growth" || PLATFORM_SITE.some((s) => s.key === section);

  return (
    <>
      <nav className="snav" aria-label="Main">
        <Link href={`/growth/${site}`} className="snav-brand">Jose&rsquo;s growth programme</Link>
        <div className="snav-links">
          <Link href={`/growth/${site}`} className={!inPlatform ? "on" : ""}>Programme</Link>
          <Link href="/suite" className={inPlatform ? "on" : ""}>Platform</Link>
        </div>
        {sites.length > 1 && (
          <select
            aria-label="Site"
            value={site}
            onChange={(e) => {
              const next = e.target.value;
              router.push(siteSection ? `/${section}/${next}` : inPlatform ? path : `/growth/${next}`);
            }}
          >
            {sites.map((s) => (
              <option key={s.slug} value={s.slug}>
                {s.name}
              </option>
            ))}
          </select>
        )}
      </nav>
      {inPlatform && (
        <nav className="pnav" aria-label="Platform modules">
          <span className="pnav-tag">Platform prototype</span>
          <div className="snav-links">
            <Link href="/suite" className={section === "suite" ? "on" : ""}>Overview</Link>
            {PLATFORM_SITE.map((s) => (
              <Link key={s.key} href={`/${s.key}/${site}`} className={section === s.key ? "on" : ""}>
                {s.label}
              </Link>
            ))}
            {PLATFORM_COMPANY.map((s) => (
              <Link key={s.key} href={`/${s.key}`} className={section === s.key ? "on" : ""}>
                {s.label}
              </Link>
            ))}
          </div>
        </nav>
      )}
    </>
  );
}
