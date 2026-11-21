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

/** Where the build step leaves a ready-made copy of the demo database (see scripts/build-demo-db.ts). */
export const SNAPSHOT = path.join(process.cwd(), ".demo", "db.tar.gz");

async function engine() {
  const [{ PGlite }, { btree_gist }, { pgcrypto }, { PGLiteSocketServer }] = await Promise.all([
    import("@electric-sql/pglite"),
    import("@electric-sql/pglite/contrib/btree_gist"),
    import("@electric-sql/pglite/contrib/pgcrypto"),
    import("@electric-sql/pglite-socket"),
  ]);
  return { PGlite, PGLiteSocketServer, extensions: { btree_gist, pgcrypto } };
}
const root = () => path.join(process.cwd(), "supabase");
const read = (...p: string[]) => readFileSync(path.join(root(), ...p), "utf8");

async function listen(db: unknown, PGLiteSocketServer: Awaited<ReturnType<typeof engine>>["PGLiteSocketServer"]) {
  const sock = path.join(tmpdir(), `joses-demo-${process.pid}.sock`);
  if (existsSync(sock)) rmSync(sock);
  const server = new PGLiteSocketServer({ db: db as never, path: sock, maxConnections: 1 });
  await server.start();
  return { sock, server };
}

/**
 * The slow, date-independent part: schema, seed, and the Growth sample and
 * starter pack at the first site. Run once at build time and saved as a snapshot.
 */
export async function buildSnapshot(): Promise<Uint8Array> {
  const { PGlite, PGLiteSocketServer, extensions } = await engine();
  const db = await PGlite.create({ extensions });
  await db.exec(read("tests", "supabase_stub.sql"));
  for (const f of readdirSync(path.join(root(), "migrations")).sort()) await db.exec(read("migrations", f));
  await db.exec(read("seed.sql"));
  const { sock, server } = await listen(db, PGLiteSocketServer);
  const sql = postgres({ path: sock, max: 1, prepare: false, onnotice: () => {} });
  try {
    const [{ loadSample }, { loadStarter }] = await Promise.all([import("./growth"), import("./growth-office")]);
    const [venue] = await sql`select id from venues order by name limit 1`;
    if (venue) {
      await loadSample(sql, venue.id);
      await loadStarter(sql, venue.id);
      await exampleProgramme(sql, venue.id);
    }
  } finally {
    await sql.end();
    await server.stop();
  }
  const dump = await db.dumpDataDir("gzip");
  await db.close();
  return new Uint8Array(await dump.arrayBuffer());
}

/** Examples so the demo shows a programme in motion: one gain banked, one test live, one waiting on a decision. */
async function exampleProgramme(sql: postgres.Sql, venueId: string) {
  const { createTest, decideTest, listIdeas, markRead } = await import("./growth-programme");
  const ideas = await listIdeas(sql, venueId);
  const idea = (start: string) => ideas.find((i) => i.change.startsWith(start))?.id;
  const common = { gainArea: "Floor service", design: "before_after", live: true };
  const drink = await createTest(sql, venueId, { ...common, ideaId: idea("First drink"), name: "First drink in two minutes", metricKey: "dpc", guardrailKey: "turn", startDay: "2026-08-24", passMarkPct: 5, ownerName: "Sofia" });
  const read = await markRead(sql, venueId, drink);
  await decideTest(sql, venueId, drink, { decision: "bank", decidedBy: "Example", yearlyValue: 46000, notes: "Example from the sample data." });
  const guarantee = await createTest(sql, venueId, { ...common, gainArea: "Welcome and bookings", ideaId: idea("Card guarantee"), name: "Card guarantee on peak slots", metricKey: "noShow", guardrailKey: "coversPerWeek", startDay: "2026-09-21", passMarkPct: -50, ownerName: "Camila" });
  await markRead(sql, venueId, guarantee);
  await createTest(sql, venueId, { ...common, ideaId: idea("Bill in three minutes"), name: "Bill in three minutes", metricKey: "turn", guardrailKey: "sph", startDay: "2026-10-05", passMarkPct: -5, ownerName: "Diego" });
  void read;
}

async function boot(): Promise<string> {
  const started = Date.now();
  const { PGlite, PGLiteSocketServer, extensions } = await engine();
  // Start from the build's snapshot when there is one; otherwise build it now (local development).
  const snapshot = existsSync(SNAPSHOT) ? readFileSync(SNAPSHOT) : await buildSnapshot();
  const db = await PGlite.create({ extensions, loadDataDir: new Blob([new Uint8Array(snapshot)]) });
  // Trading history is generated relative to today, so it is added at start-up, not baked in.
  // The script is written for psql: drop its meta-commands and fill in its one variable.
  const history = read("demo", "history.sql").split("\n").filter((l) => !l.trimStart().startsWith("\\")).join("\n")
    .replaceAll(":'days'", `'${HISTORY_DAYS}'`).replaceAll(":days", String(HISTORY_DAYS));
  await db.exec(history).catch((e) => console.error("demo history skipped:", e));
  const { sock } = await listen(db, PGLiteSocketServer);
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
