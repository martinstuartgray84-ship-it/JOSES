// Shared checks for server actions. Server actions are public endpoints, so
// every one re-checks the staff session rather than trusting the page.

import { BookingError, getSite, type Site } from "./booking";
import { db } from "./db";
import { StatusError } from "./diary";
import { KitchenError } from "./kitchen";
import { OrderError } from "./orders";
import { isStaff } from "./staff";

export type ActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

export class NotSignedIn extends Error {}

export async function staffSite(slug: string): Promise<Site> {
  if (!(await isStaff())) throw new NotSignedIn("Your session has expired. Please sign in again.");
  const site = await getSite(db(), slug);
  // Staff manage one company's sites; never another company's in the same database.
  const company = await staffCompany();
  if (site.companyId !== company.id) throw new BookingError("unknown_site", `No site called ${slug}`);
  return site;
}

export async function requireStaffAction(): Promise<void> {
  if (!(await isStaff())) throw new NotSignedIn("Your session has expired. Please sign in again.");
}

/** Errors whose message is written for staff. Plain `new Error("...")` from our services counts too. */
function isForStaff(e: unknown): e is Error {
  return (
    e instanceof NotSignedIn ||
    e instanceof OrderError ||
    e instanceof KitchenError ||
    e instanceof BookingError ||
    e instanceof StatusError ||
    (e instanceof Error && Object.getPrototypeOf(e) === Error.prototype && !("code" in e))
  );
}

/** Run an action, turning known errors into a message for the screen. */
export async function act<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    if (isForStaff(err)) return { ok: false, error: err.message };
    console.error(err);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

/** The company the staff app manages (COMPANY_SLUG, or the only one there is). */
export async function staffCompany(): Promise<{ id: string; name: string }> {
  if (!(await isStaff())) throw new NotSignedIn("Your session has expired. Please sign in again.");
  const sql = db();
  const slug = process.env.COMPANY_SLUG;
  const [c] = slug
    ? await sql`select id, name from companies where slug = ${slug}`
    : await sql`select id, name from companies order by created_at limit 1`;
  if (!c) throw new Error("No company set up yet");
  return { id: c.id, name: c.name };
}
