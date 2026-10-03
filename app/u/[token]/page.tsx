import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { db } from "@/src/server/db";
import { companyForUnsubscribe, unsubscribe } from "@/src/server/marketing";

export const metadata: Metadata = { title: "Unsubscribe", robots: { index: false } };
export const dynamic = "force-dynamic";

// Shown when a guest clicks "Unsubscribe" in an email. Confirming takes one tap;
// mail clients that support one-click unsubscribe POST to /api/u/<token> instead.
export default async function UnsubscribePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ done?: string }>;
}) {
  const { token } = await params;
  const { done } = await searchParams;
  const info = await companyForUnsubscribe(db(), token);
  if (!info) notFound();

  async function confirm() {
    "use server";
    await unsubscribe(db(), token);
    redirect(`/u/${token}?done=1`);
  }

  return (
    <main className="wrap">
      <section className="card">
        {info.done || done ? (
          <>
            <h2>You&rsquo;re unsubscribed</h2>
            <p>You won&rsquo;t get any more news or offers from {info.company}. Booking confirmations will still arrive.</p>
          </>
        ) : (
          <form action={confirm} style={{ display: "grid", gap: 16 }}>
            <h2>Unsubscribe from {info.company}?</h2>
            <p style={{ margin: 0 }}>You&rsquo;ll stop getting news and offers. Booking confirmations will still arrive.</p>
            <button type="submit" className="primary">
              Unsubscribe
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
