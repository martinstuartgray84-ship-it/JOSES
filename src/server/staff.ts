// Interim staff access: one shared password (STAFF_PASSWORD) per deployment,
// exchanged for a signed, HttpOnly session cookie. Replace with Supabase Auth
// (per-person logins, roles from company_members/venue_members) before go-live.

import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

const COOKIE = "staff_session";
const TTL_SECONDS = 60 * 60 * 16; // one long shift

function secret(): string {
  const s = process.env.STAFF_SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("STAFF_SESSION_SECRET must be set (32+ characters)");
  return s;
}

const sign = (payload: string) => createHmac("sha256", secret()).update(payload).digest("base64url");

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function checkStaffPassword(attempt: string): boolean {
  const expected = process.env.STAFF_PASSWORD;
  // No password configured means nobody gets in, never everybody.
  if (!expected) return false;
  const h = (s: string) => createHmac("sha256", "pw").update(s).digest("hex");
  return safeEqual(h(attempt), h(expected));
}

export function makeSessionValue(now = Date.now()): string {
  const payload = `v1.${Math.floor(now / 1000) + TTL_SECONDS}`;
  return `${payload}.${sign(payload)}`;
}

export function verifySessionValue(value: string | undefined, now = Date.now()): boolean {
  if (!value) return false;
  const i = value.lastIndexOf(".");
  if (i < 0) return false;
  const payload = value.slice(0, i);
  const [version, exp] = payload.split(".");
  if (version !== "v1" || !exp || !/^\d+$/.test(exp)) return false;
  if (Number(exp) * 1000 < now) return false;
  return safeEqual(value.slice(i + 1), sign(payload));
}

export async function startStaffSession() {
  (await cookies()).set(COOKIE, makeSessionValue(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: TTL_SECONDS,
  });
}

export async function endStaffSession() {
  (await cookies()).delete(COOKIE);
}

export async function isStaff(): Promise<boolean> {
  return verifySessionValue((await cookies()).get(COOKIE)?.value);
}

/** Call at the top of every staff page and server action. */
export async function requireStaff(next = "/diary"): Promise<void> {
  if (!(await isStaff())) redirect(`/staff/login?next=${encodeURIComponent(next)}`);
}
