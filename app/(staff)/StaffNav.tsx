"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

// The programme leads. The operating suite is the product being built around it.
// Sections that are per site: /<section>/<site>/...
const SUITE_SITE = [
  { key: "diary", label: "Diary" },
  { key: "pos", label: "Till" },
  { key: "floor", label: "Floor" },
  { key: "ops", label: "Ops" },
  { key: "kds", label: "Kitchen & bar" },
  { key: "menu", label: "Menu" },
] as const;
// Company-wide sections.
const SUITE_COMPANY = [
  { key: "dashboard", label: "Dashboard" },
  { key: "guests", label: "Guests" },
  { key: "marketing", label: "Marketing" },
] as const;

export default function StaffNav({ sites }: { sites: { slug: string; name: string }[] }) {
  const path = usePathname();
  const router = useRouter();
  const [, section, maybeSite] = path.split("/");
  const site = sites.find((s) => s.slug === maybeSite)?.slug ?? sites[0]?.slug ?? "";
  const siteSection = section === "growth" || SUITE_SITE.some((s) => s.key === section);

  return (
    <nav className="snav" aria-label="Main">
      <Link href={`/growth/${site}`} className="snav-brand">Growth programme</Link>
      {sites.length > 1 && (
        <select
          aria-label="Site"
          value={site}
          onChange={(e) => {
            const next = e.target.value;
            router.push(siteSection ? `/${section}/${next}` : `/growth/${next}`);
          }}
        >
          {sites.map((s) => (
            <option key={s.slug} value={s.slug}>
              {s.name}
            </option>
          ))}
        </select>
      )}
      <div className="snav-links">
        <Link href={`/growth/${site}`} className={section === "growth" ? "on" : ""}>Programme</Link>
        <span className="snav-sep">Operating suite</span>
        {SUITE_SITE.map((s) => (
          <Link key={s.key} href={`/${s.key}/${site}`} className={section === s.key ? "on" : ""}>
            {s.label}
          </Link>
        ))}
        {SUITE_COMPANY.map((s) => (
          <Link key={s.key} href={`/${s.key}`} className={section === s.key ? "on" : ""}>
            {s.label}
          </Link>
        ))}
        <span className="snav-sep" aria-hidden="true" />
        <Link href="/suite" className={section === "suite" ? "on" : ""}>Product</Link>
      </div>
    </nav>
  );
}
