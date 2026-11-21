"use client";

// Demo mode only. The demo database lives in the server's memory and is
// rebuilt whenever the server restarts, so this keeps the latest copy of the
// programme's data in the browser and puts it back when it meets a server
// that is behind. Result: what you enter stays on this device.

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { importWorkspaceAction } from "./workspace-actions";

const KEY = "joses.workspace.v1";
const COOKIE = "ws";
type Saved = { bootId: string; rev: number; data: string };

function read(): Saved | null {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? "null") as Saved | null;
    return s && typeof s.rev === "number" && typeof s.data === "string" ? s : null;
  } catch {
    return null;
  }
}
function write(s: Saved): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
    // Tells the server which copy this browser already holds, so it only sends a new one when something changed.
    document.cookie = `${COOKIE}=${s.bootId}:${s.rev}; path=/; max-age=31536000; samesite=lax`;
    return true;
  } catch {
    return false;
  }
}

export default function WorkspaceKeeper(props: { bootId: string; rev: number; data: string | null }) {
  const router = useRouter();
  const busy = useRef(false);
  const [note, setNote] = useState<"" | "restoring" | "restored" | "unsaved">("");

  useEffect(() => {
    if (busy.current) return;
    const saved = read();
    const serverAhead = !saved || props.rev >= saved.rev;
    if (serverAhead) {
      // The server has everything this browser has, or more: keep its copy.
      if (props.data != null) {
        if (!write({ bootId: props.bootId, rev: props.rev, data: props.data })) setNote("unsaved");
      } else if (!saved || saved.bootId !== props.bootId || saved.rev !== props.rev) {
        // The cookie says this browser holds the current copy but it does not (cleared storage, another tab): ask for it again.
        document.cookie = `${COOKIE}=; path=/; max-age=0`;
        router.refresh();
      }
      return;
    }
    // This browser is ahead: the server restarted, or this is a different server instance. Put the work back.
    busy.current = true;
    setNote("restoring");
    importWorkspaceAction(saved.data, saved.rev)
      .then((r) => {
        if (r.ok && r.data?.bootId) {
          write({ bootId: r.data.bootId, rev: r.data.rev ?? saved.rev, data: saved.data });
          setNote("restored");
          setTimeout(() => setNote(""), 4000);
        } else setNote("unsaved");
      })
      .catch(() => setNote("unsaved"))
      .finally(() => {
        busy.current = false;
        router.refresh();
      });
  }, [props.bootId, props.rev, props.data, router]);

  if (!note) return null;
  return (
    <p className="ws-note" role="status">
      {note === "restoring" && "Putting your saved work back…"}
      {note === "restored" && "Your saved work is back."}
      {note === "unsaved" && "This browser could not save a copy of your work (private browsing?). Download a backup from Settings before you close the tab."}
    </p>
  );
}
