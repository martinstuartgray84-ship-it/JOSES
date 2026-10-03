"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function CancelButton({ token }: { token: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cancel() {
    setBusy(true);
    setError(null);
    const r = await fetch(`/api/manage/${token}`, { method: "DELETE" });
    setBusy(false);
    if (!r.ok) {
      setError(((await r.json()) as { error?: string }).error ?? "Something went wrong");
      return;
    }
    router.refresh();
  }

  if (!confirming) {
    return (
      <button type="button" className="secondary" onClick={() => setConfirming(true)}>
        Cancel booking
      </button>
    );
  }
  return (
    <div className="confirm">
      <p>Cancel this booking? This can&rsquo;t be undone.</p>
      <div className="row">
        <button type="button" className="danger" onClick={cancel} disabled={busy}>
          {busy ? "Cancelling…" : "Yes, cancel"}
        </button>
        <button type="button" className="secondary" onClick={() => setConfirming(false)} disabled={busy}>
          Keep it
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
