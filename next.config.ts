import type { NextConfig } from "next";

// Sites allowed to embed the booking widget in an iframe, space-separated,
// e.g. "https://www.example.com https://example.com".
const embedOrigins = process.env.EMBED_ORIGINS ?? "";

const nextConfig: NextConfig = {
  // The Growth sample data is read from disk when a manager loads it.
  // and by demo mode, which also builds its database from the migrations and seed at start-up.
  outputFileTracingIncludes: {
    "/**": ["./fixtures/growth/sample/*.csv", "./supabase/migrations/*.sql", "./supabase/seed.sql", "./supabase/demo/history.sql", "./supabase/tests/supabase_stub.sql",
      "./node_modules/@electric-sql/pglite/dist/**/*.{wasm,data,tar.gz,js,cjs}", "./node_modules/@electric-sql/pglite-socket/dist/**/*.{js,cjs}"],
  },
  serverExternalPackages: ["@electric-sql/pglite", "@electric-sql/pglite-socket"],
  async headers() {
    return [
      {
        source: "/book",
        headers: [{ key: "Content-Security-Policy", value: `frame-ancestors 'self' ${embedOrigins}`.trim() }],
      },
      {
        // Manage links carry a private token: never embeddable, never leaked via Referer.
        source: "/manage/:token*",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
    ];
  },
};

export default nextConfig;
