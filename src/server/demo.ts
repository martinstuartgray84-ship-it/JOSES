// Demo mode: when no DATABASE_URL is set, the app runs on a Postgres that
// lives inside the server process (PGlite), filled with the seed, generated
// trading history and the Growth sample. It lets a fresh deployment be opened
// and explored with nothing to set up.
//
// It is NOT somewhere to keep real data: the database is rebuilt whenever the
// server restarts, and on serverless hosting each instance has its own copy.
// Set DATABASE_URL to a real Postgres to leave demo mode.

import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import postgres from "postgres";

export const isDemo = (): boolean => !process.env.DATABASE_URL;

/** Signing secret for cookies in demo mode, where there is nothing real to protect. */
export const DEMO_SECRET = "demo-mode-only-not-a-secret-0123456789abcdef";

/** Days of invented trading history for the dashboard. */
const HISTORY_DAYS = 28;

const g = globalThis as unknown as { demoDb?: Promise<string> };

async function boot(): Promise<string> {
  const started = Date.now();
  const [{ PGlite }, { btree_gist }, { pgcrypto }, { PGLiteSocketServer }] = await Promise.all([
    import("@electric-sql/pglite"),
    import("@electric-sql/pglite/contrib/btree_gist"),
    import("@electric-sql/pglite/contrib/pgcrypto"),
    import("@electric-sql/pglite-socket"),
  ]);
  const root = path.join(process.cwd(), "supabase");
  const read = (...p: string[]) => readFileSync(path.join(root, ...p), "utf8");
  const db = await PGlite.create({ extensions: { btree_gist, pgcrypto } });
  await db.exec(read("tests", "supabase_stub.sql"));
  for (const f of readdirSync(path.join(root, "migrations")).sort()) await db.exec(read("migrations", f));
  await db.exec(read("seed.sql"));
  // The history script is written for psql: drop its meta-commands and fill in the one variable.
  const history = read("demo", "history.sql").split("\n").filter((l) => !l.trimStart().startsWith("\\")).join("\n").replaceAll(":'days'", `'${HISTORY_DAYS}'`).replaceAll(":days", String(HISTORY_DAYS));
  await db.exec(history).catch((e) => console.error("demo history skipped:", e));

  const sock = path.join(tmpdir(), `joses-demo-${process.pid}.sock`);
  if (existsSync(sock)) rmSync(sock);
  await new PGLiteSocketServer({ db, path: sock, maxConnections: 1 }).start();

  // Growth: the invented 60-seat sample and the programme's starter pack, at the first site.
  const sql = postgres({ path: sock, max: 1, prepare: false, onnotice: () => {} });
  try {
    const [{ loadSample }, { loadStarter }] = await Promise.all([import("./growth"), import("./growth-office")]);
    const [venue] = await sql`select id from venues order by name limit 1`;
    if (venue) {
      await loadSample(sql, venue.id);
      await loadStarter(sql, venue.id);
    }
  } catch (e) {
    console.error("demo growth sample skipped:", e);
  } finally {
    await sql.end();
  }
  console.log(`Demo database ready in ${Date.now() - started} ms. Set DATABASE_URL to use a real one.`);
  return sock;
}

/** A connected socket to the demo database, starting it on first use. */
export async function demoSocket(): Promise<net.Socket> {
  const sock = await (g.demoDb ??= boot());
  return new Promise((resolve, reject) => {
    const s = net.connect(sock);
    s.once("connect", () => resolve(s));
    s.once("error", reject);
  });
}
