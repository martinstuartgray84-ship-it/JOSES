"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { AutomationView, CampaignSummary } from "@/src/server/marketing";
import { describeSegment, PRESETS, type Segment } from "@/src/marketing/segments";
import { PLACEHOLDERS, renderEmail } from "@/src/marketing/template";
import { formatMoney } from "@/src/pos/totals";
import {
  audienceAction,
  deleteDraftAction,
  runAutomationsAction,
  saveAutomationAction,
  saveCampaignAction,
  sendCampaignAction,
  sendTestAction,
} from "./actions";

const STARTERS: Record<string, { subject: string; body: string }> = {
  lapsed: {
    subject: "We've missed you, {{first_name}}",
    body: "Hi {{first_name}},\n\nIt's been a little while since we've seen you at {{site}}, and the menu's moved on.\n\n**This month:** the first round of drinks is on us when you book for two or more.\n\nBook a table: {{book_url}}\n\nThe team at {{company}}",
  },
  default: {
    subject: "News from {{company}}",
    body: "Hi {{first_name}},\n\n\n\nBook a table: {{book_url}}\n\nThe team at {{company}}",
  },
};

const day = (d: string | null) =>
  d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" }) : "–";
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "–");

type Draft = { id?: string; name: string; subject: string; body: string; segment: Segment };

export default function MarketingView(props: {
  companyName: string;
  emailReady: boolean;
  initialPreset: string;
  sites: { id: string; name: string }[];
  campaigns: (Omit<CampaignSummary, "createdAt" | "sentAt"> & { createdAt: string; sentAt: string | null })[];
  automations: (Omit<AutomationView, "lastRunAt"> & { lastRunAt: string | null })[];
  automationText: Record<string, { title: string; what: string }>;
}) {
  const router = useRouter();
  const preset = PRESETS.find((p) => p.key === props.initialPreset) ?? PRESETS[0]!;
  const starter = STARTERS[preset.key] ?? STARTERS.default!;
  const [draft, setDraft] = useState<Draft>({ name: "", subject: starter.subject, body: starter.body, segment: preset.segment });
  const [presetKey, setPresetKey] = useState<string | null>(preset.key);
  const [audience, setAudience] = useState<{ total: number; mailable: number; sample: string[] } | null>(null);
  const [audErr, setAudErr] = useState<string | null>(null);
  const [testTo, setTestTo] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const siteName = (id: string) => props.sites.find((s) => s.id === id)?.name;

  // Live audience count.
  useEffect(() => {
    let cancelled = false;
    const id = setTimeout(async () => {
      const r = await audienceAction(draft.segment);
      if (cancelled) return;
      if (r.ok) {
        setAudience(r.data!);
        setAudErr(null);
      } else setAudErr(r.error);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [draft.segment]);

  const preview = useMemo(
    () =>
      renderEmail({
        subject: draft.subject,
        body: draft.body,
        data: { first_name: audience?.sample[0]?.split(" ")[0] ?? "Alex", company: props.companyName, site: props.sites[0]?.name ?? props.companyName, book_url: "https://…/book" },
        unsubscribeUrl: "#",
        footer: `You're getting this because you said yes to news from ${props.companyName}.`,
      }),
    [draft.subject, draft.body, audience, props.companyName, props.sites],
  );

  const setSeg = (patch: Partial<Segment>) => {
    setPresetKey(null);
    setDraft((d) => {
      const next = { ...d.segment, ...patch } as Record<string, unknown>;
      for (const k of Object.keys(next)) if (next[k] === undefined || next[k] === "" || Number.isNaN(next[k])) delete next[k];
      return { ...d, segment: next as Segment };
    });
  };
  const num = (v: string) => (v.trim() === "" ? undefined : Number(v));
  const insert = (key: string) => {
    const el = bodyRef.current;
    const token = `{{${key}}}`;
    if (!el) return setDraft((d) => ({ ...d, body: d.body + token }));
    const start = el.selectionStart;
    const end = el.selectionEnd;
    setDraft((d) => ({ ...d, body: d.body.slice(0, start) + token + d.body.slice(end) }));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  };

  async function run<T>(fn: () => Promise<{ ok: true; data?: T } | { ok: false; error: string }>, done: (d: T | undefined) => string) {
    setBusy(true);
    setMsg(null);
    const r = await fn();
    setBusy(false);
    if (!r.ok) setMsg({ ok: false, text: r.error });
    else {
      setMsg({ ok: true, text: done(r.data) });
      router.refresh();
    }
    return r.ok;
  }

  const sent = props.campaigns.filter((c) => c.status !== "draft");
  const drafts = props.campaigns.filter((c) => c.status === "draft");

  return (
    <main className="page mk-page">
      <div className="page-head">
        <div>
          <h1>Marketing</h1>
          <p className="muted small" style={{ margin: 0 }}>
            Only guests who said yes to news, haven&rsquo;t unsubscribed and have an email are ever messaged. Every email has a one-click unsubscribe.
          </p>
        </div>
      </div>

      {!props.emailReady && (
        <p className="notice">
          <strong>No email provider connected.</strong> Sends are saved as &ldquo;logged&rdquo; and appear in results, but nothing is delivered.
          Add <code>RESEND_API_KEY</code> and <code>EMAIL_FROM</code> to switch sending on.
        </p>
      )}

      <section className="box composer">
        <h2>New campaign</h2>
        <div className="composer-grid">
          <div className="composer-left">
            <h3>Who</h3>
            <div className="seg-list">
              {PRESETS.filter((p) => p.key !== "no-shows").map((p) => (
                <button
                  key={p.key}
                  type="button"
                  className={presetKey === p.key ? "on" : ""}
                  onClick={() => {
                    setPresetKey(p.key);
                    setDraft((d) => ({ ...d, segment: p.segment }));
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <details className="custom-seg">
              <summary>Fine-tune</summary>
              <div className="row">
                <label>
                  Min visits
                  <input inputMode="numeric" value={draft.segment.minVisits ?? ""} onChange={(e) => setSeg({ minVisits: num(e.target.value) })} />
                </label>
                <label>
                  Max visits
                  <input inputMode="numeric" value={draft.segment.maxVisits ?? ""} onChange={(e) => setSeg({ maxVisits: num(e.target.value) })} />
                </label>
              </div>
              <div className="row">
                <label>
                  Not seen for (days)
                  <input inputMode="numeric" value={draft.segment.lastVisitDaysAgoMin ?? ""} onChange={(e) => setSeg({ lastVisitDaysAgoMin: num(e.target.value) })} />
                </label>
                <label>
                  Seen in the last (days)
                  <input inputMode="numeric" value={draft.segment.lastVisitDaysAgoMax ?? ""} onChange={(e) => setSeg({ lastVisitDaysAgoMax: num(e.target.value) })} />
                </label>
              </div>
              <div className="row">
                <label>
                  Spent at least (£)
                  <input inputMode="numeric" value={draft.segment.minSpend !== undefined ? draft.segment.minSpend / 100 : ""} onChange={(e) => setSeg({ minSpend: num(e.target.value) === undefined ? undefined : Math.round(num(e.target.value)! * 100) })} />
                </label>
                <label>
                  Visited
                  <select value={draft.segment.siteId ?? ""} onChange={(e) => setSeg({ siteId: e.target.value || undefined })}>
                    <option value="">Either site</option>
                    {props.sites.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label>
                Tagged
                <input value={draft.segment.tag ?? ""} onChange={(e) => setSeg({ tag: e.target.value || undefined })} placeholder="e.g. wine club" />
              </label>
            </details>
            <div className="audience" aria-live="polite">
              <p className="muted small" style={{ margin: 0 }}>
                {describeSegment(draft.segment, siteName)}
              </p>
              {audErr ? (
                <p className="error" style={{ margin: 0 }}>
                  {audErr}
                </p>
              ) : audience ? (
                <>
                  <p className="aud-count">
                    <strong className="num">{audience.mailable.toLocaleString("en-GB")}</strong> will get this
                    <span className="muted"> · {audience.total.toLocaleString("en-GB")} match, {audience.total - audience.mailable} can&rsquo;t be emailed</span>
                  </p>
                  {audience.sample.length > 0 && <p className="small muted" style={{ margin: 0 }}>e.g. {audience.sample.join(", ")}</p>}
                </>
              ) : (
                <p className="muted small">Counting…</p>
              )}
            </div>

            <h3>What</h3>
            <label>
              Subject
              <input value={draft.subject} onChange={(e) => setDraft((d) => ({ ...d, subject: e.target.value }))} maxLength={150} />
            </label>
            <label>
              Message
              <textarea ref={bodyRef} rows={10} value={draft.body} onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))} />
            </label>
            <div className="btn-row small">
              <span className="muted">Insert:</span>
              {PLACEHOLDERS.map((p) => (
                <button key={p.key} type="button" className="mini" onClick={() => insert(p.key)}>
                  {p.label}
                </button>
              ))}
            </div>
            <p className="small muted" style={{ margin: 0 }}>
              Blank line = new paragraph. **Bold** works. Links are clickable.
            </p>
            <label>
              Campaign name (for you)
              <input value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} placeholder={draft.subject.replace(/\{\{.*?\}\}/g, "").trim()} />
            </label>
          </div>

          <div className="composer-right">
            <h3>Preview</h3>
            <div className="email-preview">
              <div className="ep-subject">{preview.subject}</div>
              <iframe title="Email preview" srcDoc={preview.html} sandbox="" />
            </div>
          </div>
        </div>

        {msg && (
          <p className={msg.ok ? "ok" : "error"} role={msg.ok ? "status" : "alert"} style={{ margin: 0 }}>
            {msg.text}
          </p>
        )}
        <div className="composer-actions">
          <div className="test-send">
            <input type="email" placeholder="you@example.com" value={testTo} onChange={(e) => setTestTo(e.target.value)} aria-label="Send a test to" />
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                run(
                  () => sendTestAction({ subject: draft.subject, body: draft.body, to: testTo }),
                  (d) => (d?.status === "sent" ? `Test sent to ${testTo}` : d?.status === "logged" ? "Test saved (no email provider connected)" : `Test failed: ${d?.error}`),
                )
              }
            >
              Send test
            </button>
          </div>
          <div className="btn-row">
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                run(() => saveCampaignAction(draft), () => "Draft saved: find it under Drafts below").then(
                  (ok) => ok && setDraft({ name: "", subject: STARTERS.default!.subject, body: STARTERS.default!.body, segment: draft.segment }),
                )
              }
            >
              Save draft
            </button>
            <button type="button" className="primary" disabled={busy || !audience?.mailable} onClick={() => setConfirming(true)}>
              Send to {audience?.mailable ?? 0} guests
            </button>
          </div>
        </div>
      </section>

      {confirming && (
        <div className="scrim" onClick={(e) => e.target === e.currentTarget && setConfirming(false)}>
          <div className="dialog">
            <h2>Send now?</h2>
            <p style={{ margin: 0 }}>
              &ldquo;{preview.subject}&rdquo; goes to <strong>{audience?.mailable}</strong> guests ({describeSegment(draft.segment, siteName).toLowerCase()}). This can&rsquo;t be undone.
            </p>
            <div className="dialog-actions">
              <button type="button" onClick={() => setConfirming(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="primary"
                disabled={busy}
                onClick={async () => {
                  const ok = await run(
                    () => sendCampaignAction(draft),
                    (d) =>
                      d
                        ? `Done: ${d.recipients} recipients. ${d.sent} delivered${d.logged ? `, ${d.logged} logged (no provider)` : ""}${d.failed ? `, ${d.failed} failed` : ""}.`
                        : "Sent",
                  );
                  setConfirming(false);
                  if (ok) setDraft({ name: "", subject: STARTERS.default!.subject, body: STARTERS.default!.body, segment: {} });
                }}
              >
                Send
              </button>
            </div>
          </div>
        </div>
      )}

      <section className="box">
        <h2>Results</h2>
        <p className="muted small" style={{ marginTop: 0 }}>
          &ldquo;Came back&rdquo; = recipients with a paid visit within 30 days of the email. That&rsquo;s the number that matters; opens are a rough guide.
        </p>
        {sent.length === 0 ? (
          <p className="muted">No campaigns sent yet.</p>
        ) : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Campaign</th>
                  <th>Sent</th>
                  <th className="right">To</th>
                  <th className="right">Opened</th>
                  <th className="right">Came back</th>
                  <th className="right">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {sent.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <strong>{c.name}</strong>
                      <div className="small muted">{describeSegment(c.segment, siteName)}</div>
                      {c.logged > 0 && <span className="chip">logged, not sent</span>}
                      {c.failed > 0 && <span className="chip bad">{c.failed} failed</span>}
                    </td>
                    <td>{day(c.sentAt)}</td>
                    <td className="right num">{c.recipients}</td>
                    <td className="right num">{pct(c.opened, c.recipients)}</td>
                    <td className="right num">
                      {c.cameBack} <span className="muted">({pct(c.cameBack, c.recipients)})</span>
                    </td>
                    <td className="right num">{formatMoney(c.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {drafts.length > 0 && (
          <>
            <h3>Drafts</h3>
            <ul className="drafts">
              {drafts.map((c) => (
                <li key={c.id}>
                  <span>
                    <strong>{c.name}</strong> <span className="muted small">· {describeSegment(c.segment, siteName)}</span>
                  </span>
                  <span className="btn-row">
                    <button
                      type="button"
                      className="mini"
                      onClick={() => {
                        setDraft({ id: c.id, name: c.name, subject: c.subject, body: c.body, segment: c.segment });
                        setPresetKey(null);
                        window.scrollTo({ top: 0, behavior: "smooth" });
                      }}
                    >
                      Edit
                    </button>
                    <button type="button" className="mini danger-outline" onClick={() => run(() => deleteDraftAction(c.id), () => "Draft deleted")}>
                      Delete
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="box">
        <div className="page-head">
          <h2 style={{ margin: 0 }}>Automations</h2>
          <button type="button" disabled={busy} onClick={() => run(() => runAutomationsAction(), (d) => {
            const v = Object.values(d ?? {});
            const total = v.reduce((n, x) => n + x.queued, 0);
            const sent = v.reduce((n, x) => n + x.sent, 0);
            const logged = v.reduce((n, x) => n + x.logged, 0);
            if (!total) return "Nobody due right now";
            return `${total} automated email${total === 1 ? "" : "s"}: ${sent} delivered${logged ? `, ${logged} logged (no email provider)` : ""}`;
          })}>
            Run now
          </button>
        </div>
        <p className="muted small">
          These run by themselves every hour once switched on (see README: <code>/api/cron/hourly</code>). Nobody gets the same automation twice for the same occasion, and nobody gets more than one marketing email a week from them.
        </p>
        <div className="autos">
          {props.automations.map((a) => (
            <AutomationCard key={a.kind} a={a} text={props.automationText[a.kind]!} onSave={(input) => run(() => saveAutomationAction(a.kind, input), () => "Automation saved")} />
          ))}
        </div>
      </section>
    </main>
  );
}

const PARAM_LABELS: Record<string, string> = {
  lapsedDays: "After days away",
  minVisits: "Min visits before",
  afterHours: "Hours after the visit",
  daysBefore: "Days before birthday",
};

function AutomationCard(props: {
  a: { kind: string; enabled: boolean; subject: string; body: string; params: Record<string, number>; lastRunAt: string | null; sent30d: number; cameBack30d: number };
  text: { title: string; what: string };
  onSave: (input: { enabled: boolean; subject: string; body: string; params: Record<string, number> }) => Promise<boolean>;
}) {
  const { a } = props;
  const [enabled, setEnabled] = useState(a.enabled);
  const [params, setParams] = useState(a.params);
  const [subject, setSubject] = useState(a.subject);
  const [body, setBody] = useState(a.body);
  return (
    <div className={`auto ${enabled ? "on" : ""}`}>
      <div className="auto-head">
        <div>
          <h3>{props.text.title}</h3>
          <p className="small muted" style={{ margin: 0 }}>
            {props.text.what}
          </p>
        </div>
        <label className="switch">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          <span>{enabled ? "On" : "Off"}</span>
        </label>
      </div>
      <div className="row">
        {Object.keys(params).map((k) => (
          <label key={k}>
            {PARAM_LABELS[k] ?? k}
            <input inputMode="numeric" value={params[k]} onChange={(e) => setParams((p) => ({ ...p, [k]: Number(e.target.value.replace(/\D/g, "")) }))} />
          </label>
        ))}
      </div>
      <details>
        <summary className="small">Edit the email</summary>
        <label>
          Subject
          <input value={subject} onChange={(e) => setSubject(e.target.value)} />
        </label>
        <label>
          Message
          <textarea rows={7} value={body} onChange={(e) => setBody(e.target.value)} />
        </label>
      </details>
      <p className="small muted" style={{ margin: 0 }}>
        Last 30 days: {a.sent30d} sent · {a.cameBack30d} came back{a.lastRunAt ? ` · last ran ${day(a.lastRunAt)}` : ""}
      </p>
      <button type="button" onClick={() => props.onSave({ enabled, subject, body, params })}>
        Save
      </button>
    </div>
  );
}
