"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

// Sections that are per site: /<section>/<site>/...
const SITE_SECTIONS = [
  { key: "diary", label: "Diary" },
  { key: "pos", label: "Till" },
  { key: "floor", label: "Floor" },
  { key: "kds", label: "Kitchen & bar" },
  { key: "menu", label: "Menu" },
] as const;

// Company-wide sections.
const COMPANY_SECTIONS = [
  { key: "dashboard", label: "Dashboard" },
  { key: "guests", label: "Guests" },
  { key: "marketing", label: "Marketing" },
] as const;

export default function StaffNav({ sites }: { sites: { slug: string; name: string }[] }) {
  const path = usePathname();
  const router = useRouter();
  const [, section, maybeSite] = path.split("/");
  const site = sites.find((s) => s.slug === maybeSite)?.slug ?? sites[0]?.slug ?? "";
  const siteSection = SITE_SECTIONS.some((s) => s.key === section);

  return (
    <nav className="snav" aria-label="Staff">
      <span className="snav-brand">Jose&rsquo;s</span>
      {sites.length > 1 && (
        <select
          aria-label="Site"
          value={site}
          onChange={(e) => {
            const next = e.target.value;
            router.push(siteSection ? `/${section}/${next}` : `/diary/${next}`);
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
        {SITE_SECTIONS.map((s) => (
          <Link key={s.key} href={`/${s.key}/${site}`} className={section === s.key ? "on" : ""}>
            {s.label}
          </Link>
        ))}
        {COMPANY_SECTIONS.map((s) => (
          <Link key={s.key} href={`/${s.key}`} className={section === s.key ? "on" : ""}>
            {s.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
