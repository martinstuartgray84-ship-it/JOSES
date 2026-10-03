import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { checkStaffPassword, startStaffSession } from "@/src/server/staff";

export const metadata: Metadata = { title: "Staff sign in", robots: { index: false } };

/** Only same-site paths, so the login can't be used to bounce people elsewhere. */
const safeNext = (n: unknown) => (typeof n === "string" && /^\/(?!\/)[\w\-/?=&.%]*$/.test(n) ? n : "/diary");

async function signIn(formData: FormData) {
  "use server";
  const next = safeNext(formData.get("next"));
  if (!checkStaffPassword(String(formData.get("password") ?? ""))) {
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
            That password didn&rsquo;t work.
          </p>
        )}
        <button type="submit" className="primary">
          Sign in
        </button>
      </form>
    </main>
  );
}
