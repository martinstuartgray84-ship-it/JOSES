// The programme workspace as one document: everything a site's programme
// holds apart from the loaded till data. Used for backups (download, restore),
// for moving from demo mode to a real database, and by demo mode to keep a
// copy in the browser so work survives a server restart.

import type { Sql, TransactionSql } from "postgres";

type Db = Sql | TransactionSql;

/** Insert order (parents first). Deleted in reverse. */
const TABLES = [
  "growth_settings", "growth_column_maps", "growth_bridge", "growth_ideas", "growth_tests", "growth_gains", "growth_scorecards",
  "growth_enquiries", "growth_events", "growth_actions", "growth_decisions", "growth_bets", "growth_meetings", "growth_turnaways",
] as const;
type Table = (typeof TABLES)[number];
/** Per-database bookkeeping that must not travel with a backup. */
const SKIP_COLUMNS = new Set(["data_version"]);
const MAX_ROWS = 20_000;

export interface Workspace {
  version: 1;
  exportedAt: string;
  /** Sites by slug, so a backup restores into a database whose ids differ. */
  venues: { id: string; slug: string; name: string }[];
  tables: Record<string, Record<string, unknown>[]>;
}

export async function exportWorkspace(sql: Db, companyId: string): Promise<Workspace> {
  const venues = await sql<{ id: string; slug: string; name: string }[]>`select id, slug, name from venues where company_id = ${companyId} order by slug`;
  const ids = venues.map((v) => v.id);
  const tables: Workspace["tables"] = {};
  for (const t of TABLES) {
    const [r] = await sql.unsafe(`select coalesce(jsonb_agg(to_jsonb(t) - 'data_version' order by (to_jsonb(t) - 'data_version')::text), '[]'::jsonb) as rows from ${t} t where venue_id = any($1::uuid[])`, [ids as never]);
    tables[t] = (r?.rows ?? []) as Record<string, unknown>[];
  }
  return { version: 1, exportedAt: new Date().toISOString(), venues: [...venues], tables };
}

export class WorkspaceError extends Error {}

function check(input: unknown): Workspace {
  const w = input as Workspace;
  if (!w || typeof w !== "object" || w.version !== 1 || !Array.isArray(w.venues) || !w.tables || typeof w.tables !== "object")
    throw new WorkspaceError("That file is not a programme backup from this app.");
  for (const t of TABLES) {
    const rows = w.tables[t];
    if (rows == null) continue;
    if (!Array.isArray(rows) || rows.length > MAX_ROWS || rows.some((r) => !r || typeof r !== "object" || Array.isArray(r)))
      throw new WorkspaceError(`The backup's ${t} section is not readable.`);
  }
  return w;
}

/**
 * Replace the company's programme data with a backup. Sites are matched by
 * slug; rows for sites this company does not have are left out. All or nothing.
 */
export async function importWorkspace(sql: Sql, companyId: string, input: unknown): Promise<{ rows: number; skipped: number }> {
  const w = check(input);
  return sql.begin(async (tx) => {
    const mine = await tx<{ id: string; slug: string }[]>`select id, slug from venues where company_id = ${companyId}`;
    const bySlug = new Map(mine.map((v) => [v.slug, v.id]));
    const ids = mine.map((v) => v.id);
    // Old site id -> this database's id for the same slug.
    const map = new Map<string, string>();
    for (const v of w.venues) {
      const id = bySlug.get(String(v.slug));
      if (id) {
        map.set(String(v.id), id);
        if (typeof v.name === "string" && v.name.trim()) await tx`update venues set name = ${v.name.trim().slice(0, 120)} where id = ${id}`;
      }
    }
    for (const t of [...TABLES].reverse()) await tx.unsafe(`delete from ${t} where venue_id = any($1::uuid[])`, [ids as never]);
    let rows = 0;
    let skipped = 0;
    for (const t of TABLES) {
      const cols = new Set((await tx`select column_name from information_schema.columns where table_schema = 'public' and table_name = ${t}`).map((r) => r.column_name as string));
      const keep: Record<string, unknown>[] = [];
      for (const r of w.tables[t] ?? []) {
        const venue = map.get(String(r.venue_id));
        if (!venue) {
          skipped++;
          continue;
        }
        keep.push({ ...r, venue_id: venue });
      }
      if (!keep.length) continue;
      // Only columns both the backup and this database know: a backup from an older or newer version still loads.
      const use = [...new Set(keep.flatMap((r) => Object.keys(r)))].filter((c) => cols.has(c) && !SKIP_COLUMNS.has(c) && /^[a-z_][a-z0-9_]*$/.test(c));
      const list = use.map((c) => `"${c}"`).join(", ");
      await tx.unsafe(`insert into ${t} (${list}) select ${list} from jsonb_populate_recordset(null::${t}, $1::text::jsonb)`, [JSON.stringify(keep)]);
      rows += keep.length;
    }
    return { rows, skipped };
  });
}

export type { Table as WorkspaceTable };
export const WORKSPACE_TABLES: readonly string[] = TABLES;
