"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { exportWorkspaceAction, importWorkspaceAction, resetDemoAction } from "./workspace-actions";

/** Download the programme as a file, restore it from one, and (in the demo) start again from the sample. */
export default function BackupTools({ demo, name }: { demo: boolean; name: string }) {
  const router = useRouter();
  const file = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ error: boolean; text: string } | null>(null);
  const say = (error: boolean, text: string) => setMsg({ error, text });

  const download = () =>
    start(async () => {
      const r = await exportWorkspaceAction();
      if (!r.ok || !r.data) return say(true, r.ok ? "Nothing to download." : r.error);
      const url = URL.createObjectURL(new Blob([r.data], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `${name}-programme-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      say(false, "Backup downloaded.");
    });

  const restore = (f: File | undefined) => {
    if (!f) return;
    if (!window.confirm("Replace everything in the programme (plan, bets, ideas, tests, gains, meetings, settings) with this backup?")) return;
    start(async () => {
      const r = await importWorkspaceAction(await f.text());
      if (file.current) file.current.value = "";
      if (!r.ok) return say(true, r.error);
      say(false, `Restored ${r.data?.rows ?? 0} records.`);
      router.refresh();
    });
  };

  const reset = () => {
    if (!window.confirm("Put the programme back to the sample it started with? Everything you have entered will be removed.")) return;
    start(async () => {
      const r = await resetDemoAction();
      if (!r.ok) return say(true, r.error);
      say(false, "Back to the starting sample.");
      router.refresh();
    });
  };

  return (
    <div>
      <div className="btn-row">
        <button type="button" onClick={download} disabled={pending}>Download a backup</button>
        <button type="button" onClick={() => file.current?.click()} disabled={pending}>Restore from a backup</button>
        {demo && <button type="button" className="ghost danger-outline" onClick={reset} disabled={pending}>Start again from the sample</button>}
        <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => restore(e.target.files?.[0])} aria-label="Backup file" />
      </div>
      {msg && <p className={msg.error ? "error" : "hint"} role={msg.error ? "alert" : "status"} style={{ marginTop: 8 }}>{msg.text}</p>}
    </div>
  );
}
