import postgres from "postgres";

// One pool per server process. In dev, Next.js hot reload re-evaluates modules,
// so keep the pool on globalThis to avoid leaking connections.
const globalForDb = globalThis as unknown as { sql?: postgres.Sql };

export function db(): postgres.Sql {
  if (!globalForDb.sql) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    // prepare: false keeps this compatible with Supabase's transaction pooler (port 6543).
    globalForDb.sql = postgres(url, { prepare: false, max: 10, onnotice: () => {} });
  }
  return globalForDb.sql;
}
