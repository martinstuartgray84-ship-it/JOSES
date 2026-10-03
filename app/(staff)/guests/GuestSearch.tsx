"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

/** Search box that updates the URL as you type (debounced). */
export default function GuestSearch({ initial }: { initial: string }) {
  const [q, setQ] = useState(initial);
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  useEffect(() => {
    if (q === (params.get("q") ?? "")) return;
    const id = setTimeout(() => {
      const p = new URLSearchParams(params);
      if (q.trim()) p.set("q", q.trim());
      else p.delete("q");
      p.delete("page");
      router.replace(`${path}${p.size ? `?${p}` : ""}`);
    }, 300);
    return () => clearTimeout(id);
  }, [q, params, path, router]);
  return (
    <input
      type="search"
      value={q}
      onChange={(e) => setQ(e.target.value)}
      placeholder="Name, email or phone"
      aria-label="Search guests"
      style={{ width: 260, maxWidth: "100%" }}
    />
  );
}
