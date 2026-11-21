"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FIELDS, autoMap, type FileKind } from "@/src/growth/engine";
import { parseDelimited } from "@/src/menu/import";
import type { ImportRecord } from "@/src/server/growth";
import { finishImportAction, importChunkAction, startImportAction } from "./actions";

const CHUNK = 400_000; // characters per request, well under the server action limit

/** Index just past the first line break that is not inside a quoted field, at or after `from`. */
function lineEnd(text: string, from: number, start = 0): number {
  let quoted = false;
  for (let i = start; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 34) quoted = !quoted;
    else if (c === 10 && !quoted && i >= from) return i + 1;
  }
  return text.length;
}

const TITLES: Record<FileKind, { title: string; note: string }> = {
  checks: { title: "Checks", note: "One row per bill. Times as YYYY-MM-DD HH:MM or DD/MM/YYYY HH:MM. Totals net of VAT and service charge." },
  items: { title: "Items", note: "One row per item line. net_price is the line total; unit_cost is the recipe cost of one. Unlocks drinks, menu and margin." },
  bookings: { title: "Bookings", note: "One row per reservation. Status is seated, no-show or cancelled." },
};

export default function Uploader(props: { slug: string; kind: FileKind; saved?: Record<string, string | null>; blocked?: string }) {
  const { kind, slug } = props;
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [first, setFirst] = useState<Record<string, string>>({});
  const [mapping, setMapping] = useState<Record<string, string | null>>({});
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ImportRecord | null>(null);

  async function choose(f: File | null) {
    setFile(f);
    setResult(null);
    setError("");
    if (!f) return setHeaders([]);
    const rows = parseDelimited(await f.slice(0, 65_536).text());
    const h = (rows[0] ?? []).map((x) => x.trim());
    if (!h.length) return setError("That file looks empty.");
    setHeaders(h);
    setFirst(Object.fromEntries(h.map((name, i) => [name, rows[1]?.[i] ?? ""])));
    setMapping(autoMap(kind, h, props.saved));
  }

  async function load() {
    if (!file) return;
    setError("");
    setProgress(0);
    let id = "";
    try {
      const text = (await file.text()).replace(/^﻿/, "").replace(/\r\n?/g, "\n");
      const started = await startImportAction(slug, { kind, filename: file.name, headers, mapping });
      if (!started.ok) throw new Error(started.error);
      id = started.data!;
      let at = lineEnd(text, 0); // skip the header line
      while (at < text.length) {
        const end = lineEnd(text, at + CHUNK, at);
        const r = await importChunkAction(slug, id, text.slice(at, end));
        if (!r.ok) throw new Error(r.error);
        at = end;
        setProgress(at / text.length);
      }
      const done = await finishImportAction(slug, id);
      if (!done.ok) throw new Error(done.error);
      setResult(done.data!);
      setFile(null);
      setHeaders([]);
      router.refresh();
    } catch (e) {
      const msg = (e as Error).message || "The upload stopped. Check your connection and try again.";
      setError(msg);
      if (id) await finishImportAction(slug, id, msg).catch(() => {});
      router.refresh();
    } finally {
      setProgress(null);
    }
  }

  const missing = FIELDS[kind].filter((f) => f.required && !mapping[f.field]);
  return (
    <section className="box">
      <h2>
        {TITLES[kind].title} <span className={`chip ${kind === "checks" ? "warn" : ""}`}>{kind === "checks" ? "Required" : "Optional"}</span>
      </h2>
      <p className="small muted" style={{ marginTop: 0 }}>{TITLES[kind].note}</p>
      {props.blocked ? (
        <p className="hint">{props.blocked}</p>
      ) : (
        <label>
          CSV file
          <input key={result?.id ?? "f"} type="file" accept=".csv,.tsv,.txt,text/csv" disabled={progress != null} onChange={(e) => choose(e.target.files?.[0] ?? null)} />
        </label>
      )}
      {headers.length > 0 && (
        <>
          <h3 style={{ marginTop: 14 }}>Match the columns</h3>
          <div className="gmap">
            {FIELDS[kind].map((f) => (
              <label key={f.field}>
                <span>
                  {f.field} {f.required && <span className="chip warn">Needed</span>} <small>{f.note}</small>
                </span>
                <select value={mapping[f.field] ?? ""} disabled={progress != null} onChange={(e) => setMapping({ ...mapping, [f.field]: e.target.value || null })}>
                  <option value="">Not in this file</option>
                  {headers.map((h) => (
                    <option key={h} value={h}>
                      {h}{first[h] ? ` (e.g. ${first[h].slice(0, 24)})` : ""}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <p className="gnote">Matched automatically from the column names. Correct anything that is wrong; the choice is remembered for this site.</p>
          <div className="btn-row" style={{ marginTop: 10 }}>
            <button type="button" className="primary" disabled={progress != null || missing.length > 0} onClick={load}>
              {progress != null ? "Loading" : `Load ${file?.name ?? "file"}`}
            </button>
          </div>
          {missing.length > 0 && <p className="hint">Choose a column for {missing.map((f) => f.field).join(" and ")} to continue.</p>}
        </>
      )}
      {progress != null && (
        <div className="gprog" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100} style={{ marginTop: 10 }}>
          <i style={{ width: `${progress * 100}%` }} />
        </div>
      )}
      {error && <p className="error" role="alert" style={{ marginTop: 10 }}>{error}</p>}
      {result && (
        <p className="summary" role="status" style={{ marginTop: 10 }}>
          Loaded {result.rowsLoaded.toLocaleString("en-GB")} of {result.rowsRead.toLocaleString("en-GB")} rows ({result.rowsNew.toLocaleString("en-GB")} new
          {result.rowsSkipped ? `, ${result.rowsSkipped.toLocaleString("en-GB")} skipped: see the report below` : ", none skipped"}).
        </p>
      )}
    </section>
  );
}
