import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { db } from "@/src/server/db";
import { BookingError, getSite } from "@/src/server/booking";
import { loadMenu } from "@/src/server/menu";
import { getOrder, listStaff, OrderError } from "@/src/server/orders";
import { liveFloor } from "@/src/server/floor";
import { requireStaff, tillUserId } from "@/src/server/staff";
import CheckScreen from "./CheckScreen";
import "../../../pos.css";

export const metadata: Metadata = { title: "Check", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function CheckPage({ params }: { params: Promise<{ site: string; order: string }> }) {
  const { site: slug, order: orderId } = await params;
  await requireStaff(`/pos/${slug}/check/${orderId}`);
  if (!/^[0-9a-f-]{36}$/.test(orderId)) notFound();
  try {
    const site = await getSite(db(), slug);
    const userId = await tillUserId();
    const user = (await listStaff(db(), site.companyId)).find((s) => s.id === userId);
    if (!user) redirect(`/pos/${slug}`);
    const order = await getOrder(db(), orderId);
    if (order.venueId !== site.id) notFound();
    const [menu, tables, coach] = await Promise.all([
      loadMenu(db(), site),
      db()`select t.id, t.label from tables t where t.venue_id = ${site.id} and t.active
            and not exists (select 1 from orders o where o.table_id = t.id and o.status = 'open')
            order by length(t.label), t.label`,
      order.status === "open" ? liveFloor(db(), site) : Promise.resolve(null),
    ]);
    const nudges = coach?.tables.find((t) => t.orderId === order.id)?.result.nudges.slice(0, 2) ?? [];
    return (
      <CheckScreen
        site={{ slug, name: site.name }}
        user={user}
        order={order}
        menu={menu.map((c) => ({ ...c, items: c.items.filter((i) => i.active && !i.hidden) })).filter((c) => c.items.length)}
        freeTables={tables.map((t) => ({ id: t.id as string, label: t.label as string }))}
        nudges={nudges.map((n) => ({ title: n.title, detail: n.detail, priority: n.priority }))}
      />
    );
  } catch (err) {
    if (err instanceof BookingError || (err instanceof OrderError && err.code === "not_found")) notFound();
    throw err;
  }
}
