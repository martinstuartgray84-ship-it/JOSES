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

// --- Sign-in rate limit: the shared password is one secret for the whole team.
// One address is blocked after repeated failures. Across all addresses we only
// slow down (never block), so an attacker can't lock the team out mid-service.

export const LOGIN_LIMITS = { windowMinutes: 15, perIp: 10, globalSlowdown: 50 };

export async function loginBlocked(sql: import("postgres").Sql, ip: string, now = new Date()): Promise<{ blocked: boolean; slow: boolean }> {
  const since = new Date(now.getTime() - LOGIN_LIMITS.windowMinutes * 60_000);
  const [r] = await sql`
    select count(*) filter (where ip = ${ip})::int as ip_n, count(*)::int as all_n
    from staff_login_failures where at > ${since}`;
  return { blocked: r!.ip_n >= LOGIN_LIMITS.perIp, slow: r!.all_n >= LOGIN_LIMITS.globalSlowdown };
}

export async function recordLoginFailure(sql: import("postgres").Sql, ip: string, now = new Date()) {
  await sql`insert into staff_login_failures (ip, at) values (${ip}, ${now})`;
  // Keep the table small.
  await sql`delete from staff_login_failures where at < ${new Date(now.getTime() - 24 * 3_600_000)}`;
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

// --- Till user: which staff member is using this device (after the shared sign-in).

const POS_COOKIE = "pos_staff";
const POS_TTL_SECONDS = 60 * 60 * 12;

export function signValue(value: string, ttlSeconds: number, now = Date.now()): string {
  const payload = `${value}.${Math.floor(now / 1000) + ttlSeconds}`;
  return `${payload}.${sign(`till:${payload}`)}`;
}

export function readSignedValue(raw: string | undefined, now = Date.now()): string | null {
  if (!raw) return null;
  const i = raw.lastIndexOf(".");
  if (i < 0) return null;
  const payload = raw.slice(0, i);
  if (!safeEqual(raw.slice(i + 1), sign(`till:${payload}`))) return null;
  const j = payload.lastIndexOf(".");
  const exp = payload.slice(j + 1);
  if (j < 0 || !/^\d+$/.test(exp) || Number(exp) * 1000 < now) return null;
  return payload.slice(0, j);
}

export async function setTillUser(staffId: string) {
  (await cookies()).set(POS_COOKIE, signValue(staffId, POS_TTL_SECONDS), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: POS_TTL_SECONDS,
  });
}

export async function clearTillUser() {
  (await cookies()).delete(POS_COOKIE);
}

/** The staff id signed in on the till, if any. */
export async function tillUserId(): Promise<string | null> {
  return readSignedValue((await cookies()).get(POS_COOKIE)?.value);
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
