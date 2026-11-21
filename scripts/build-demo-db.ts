// Builds the demo database once, at build time, so a server with no
// DATABASE_URL starts in about a second instead of rebuilding it on every
// cold start. Run by `npm run build`; output is .demo/db.tar.gz (not committed).
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { SEED, SNAPSHOT, buildSnapshot } from "../src/server/demo";

const started = Date.now();
const { db: bytes, seed } = await buildSnapshot();
mkdirSync(path.dirname(SNAPSHOT), { recursive: true });
writeFileSync(SNAPSHOT, bytes);
writeFileSync(SEED, seed);
console.log(`Demo database snapshot: ${(bytes.length / 1e6).toFixed(1)} MB in ${Date.now() - started} ms`);
process.exit(0);
