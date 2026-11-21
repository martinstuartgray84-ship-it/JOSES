"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

type Result = { ok: true; data?: unknown } | { ok: false; error: string };

/** A form bound to a server action: shows the action's error, resets and refreshes on success. */
export default function ActionForm(props: {
  action: (fd: FormData) => Promise<Result>;
  children: React.ReactNode;
  className?: string;
  /** Ask before running, for anything that removes data. */
  confirm?: string;
  /** Keep the entered values after a successful save. */
  keep?: boolean;
}) {
  const router = useRouter();
  const ref = useRef<HTMLFormElement>(null);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ error: boolean; text: string } | null>(null);
  return (
    <form
      ref={ref}
      className={props.className}
      onSubmit={(e) => {
        e.preventDefault();
        if (props.confirm && !window.confirm(props.confirm)) return;
        const fd = new FormData(e.currentTarget);
        setMsg(null);
        start(async () => {
          const r = await props.action(fd);
          if (!r.ok) return setMsg({ error: true, text: r.error });
          if (typeof r.data === "string") setMsg({ error: false, text: r.data });
          if (!props.keep) ref.current?.reset();
          router.refresh();
        });
      }}
    >
      <fieldset disabled={pending} className="af">
        {props.children}
      </fieldset>
      {msg && (
        <p className={msg.error ? "error" : "hint"} role={msg.error ? "alert" : "status"}>
          {msg.text}
        </p>
      )}
    </form>
  );
}
