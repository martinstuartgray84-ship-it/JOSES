import { db } from "@/src/server/db";
import { listSites } from "@/src/server/manage";
import { isStaff } from "@/src/server/staff";
import StaffNav from "./StaffNav";
import "./staff.css";

// Pages still call requireStaff() themselves: a layout isn't a security boundary.
export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  if (!(await isStaff())) return <>{children}</>;
  const sites = await listSites(db(), process.env.COMPANY_SLUG);
  return (
    <>
      <StaffNav sites={sites.map((s) => ({ slug: s.slug, name: s.name }))} />
      {children}
    </>
  );
}
