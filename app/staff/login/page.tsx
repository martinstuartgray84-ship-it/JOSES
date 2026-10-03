import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/src/server/db";
import { checkStaffPassword, loginBlocked, recordLoginFailure, startStaffSession } from "@/src/server/staff";

export const metadata: Metadata = { title: "Staff sign in", robots: { index: false } };

/** Only same-site paths, so the login can't be used to bounce people elsewhere. */
const safeNext = (n: unknown) => (typeof n === "string" && /^\/(?!\/)[\w\-/?=&.%]*$/.test(n) ? n : "/diary");

async function signIn(formData: FormData) {
  "use server";
  const next = safeNext(formData.get("next"));
  const h = await headers();
  // Behind a proxy (Vercel, Supabase) the client is the first forwarded address.
  const ip = (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "unknown").trim().slice(0, 64);
  const limit = await loginBlocked(db(), ip);
  if (limit.blocked) redirect(`/staff/login?error=locked&next=${encodeURIComponent(next)}`);
  if (limit.slow) await new Promise((r) => setTimeout(r, 3000)); // many failures everywhere: slow everyone down
  if (!checkStaffPassword(String(formData.get("password") ?? ""))) {
    await recordLoginFailure(db(), ip);
    await new Promise((r) => setTimeout(r, 750)); // slow down guessing
    redirect(`/staff/login?error=1&next=${encodeURIComponent(next)}`);
  }
  await startStaffSession();
  redirect(next);
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  return (
    <main className="wrap">
      <form className="card" action={signIn}>
        <h2>Staff sign in</h2>
        <input type="hidden" name="next" value={safeNext(next)} />
        <label>
          Password
          <input name="password" type="password" required autoFocus autoComplete="current-password" />
        </label>
        {error && (
          <p className="error" role="alert">
            {error === "locked" ? "Too many wrong tries. Wait 15 minutes and try again." : "That password didn\u2019t work."}
          </p>
        )}
        <button type="submit" className="primary">
          Sign in
        </button>
      </form>
    </main>
  );
}
