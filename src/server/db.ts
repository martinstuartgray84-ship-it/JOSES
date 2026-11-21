import postgres from "postgres";
import { demoSocket, isDemo } from "./demo";

// One pool per server process. In dev, Next.js hot reload re-evaluates modules,
// so keep the pool on globalThis to avoid leaking connections.
const globalForDb = globalThis as unknown as { sql?: postgres.Sql };

export function db(): postgres.Sql {
  if (!globalForDb.sql) {
    const url = process.env.DATABASE_URL;
    // No database configured: run on the built-in demo database (see ./demo). One
    // connection, because it is a single in-process Postgres.
    if (isDemo() || !url) return (globalForDb.sql = postgres({ socket: demoSocket, max: 1, prepare: false, onnotice: () => {} } as unknown as postgres.Options<{}>));
    // prepare: false keeps this compatible with Supabase's transaction pooler (port 6543).
    globalForDb.sql = postgres(url, { prepare: false, max: 10, onnotice: () => {} });
  }
  return globalForDb.sql;
}
