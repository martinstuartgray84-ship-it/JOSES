"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

// Two sides. The programme is the engagement at the first site. The product is
// what a restaurant runs on; its modules are grouped the way a restaurant thinks.
const PRODUCT: { label: string; mods: { key: string; label: string; perSite: boolean }[] }[] = [
  { label: "Front of house", mods: [{ key: "diary", label: "Bookings", perSite: true }, { key: "floor", label: "Floor", perSite: true }, { key: "pos", label: "Till", perSite: true }] },
  { label: "Kitchen and bar", mods: [{ key: "kds", label: "Screens", perSite: true }, { key: "menu", label: "Menu", perSite: true }, { key: "ops", label: "Ops", perSite: true }] },
  { label: "Guests", mods: [{ key: "guests", label: "Guest list", perSite: false }, { key: "marketing", label: "Marketing", perSite: false }] },
  { label: "Numbers", mods: [{ key: "dashboard", label: "Dashboard", perSite: false }] },
];
const MODS = PRODUCT.flatMap((g) => g.mods);

export default function StaffNav({ sites, programmeName }: { sites: { slug: string; name: string }[]; programmeName: string }) {
  const path = usePathname();
  const router = useRouter();
  const [, section, maybeSite] = path.split("/");
  const mod = MODS.find((m) => m.key === section);
  const side = section === "growth" ? "programme" : mod || section === "suite" ? "product" : "home";
  const site = sites.find((s) => s.slug === maybeSite)?.slug ?? sites[0]?.slug ?? "";

  return (
    <>
      <nav className={`snav side-${side}`} aria-label="Main">
        <Link href="/" className="snav-brand">{programmeName}</Link>
        <div className="snav-links">
          <Link href={`/growth/${sites[0]?.slug ?? ""}`} className={side === "programme" ? "on" : ""} aria-current={side === "programme" ? "true" : undefined}>Programme</Link>
          <Link href="/suite" className={side === "product" ? "on" : ""} aria-current={side === "product" ? "true" : undefined}>Product</Link>
        </div>
      </nav>
      {side === "product" && (
        <nav className="pnav" aria-label="Product">
          <div className="pnav-groups">
            <div className="pnav-group">
              <Link href="/suite" className={section === "suite" ? "on" : ""}>Overview</Link>
            </div>
            {PRODUCT.map((g) => (
              <div key={g.label} className="pnav-group">
                <span className="pnav-label">{g.label}</span>
                {g.mods.map((m) => (
                  <Link key={m.key} href={m.perSite ? `/${m.key}/${site}` : `/${m.key}`} className={section === m.key ? "on" : ""}>
                    {m.label}
                  </Link>
                ))}
              </div>
            ))}
          </div>
          {sites.length > 1 && mod?.perSite && (
            <select aria-label="Site" value={site} onChange={(e) => router.push(`/${section}/${e.target.value}`)}>
              {sites.map((s) => (
                <option key={s.slug} value={s.slug}>
                  {s.name}
                </option>
              ))}
            </select>
          )}
        </nav>
      )}
    </>
  );
}
