import { db } from "@/src/server/db";
import { getSettings, programmeSites } from "@/src/server/growth";
import { isStaff } from "@/src/server/staff";
import StaffNav from "./StaffNav";
import "./staff.css";

// Pages still call requireStaff() themselves: a layout isn't a security boundary.
export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  if (!(await isStaff())) return <>{children}</>;
  const sql = db();
  // The programme's site comes first, and its programme's own name leads the bar.
  const sites = await programmeSites(sql, process.env.COMPANY_SLUG);
  const programmeName = sites[0] ? (await getSettings(sql, sites[0].id)).programmeName : "Every Hour";
  return (
    <>
      <StaffNav sites={sites.map((s) => ({ slug: s.slug, name: s.name }))} programmeName={programmeName} />
      {children}
    </>
  );
}
