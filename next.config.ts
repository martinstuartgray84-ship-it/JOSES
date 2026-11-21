import type { NextConfig } from "next";

// Sites allowed to embed the booking widget in an iframe, space-separated,
// e.g. "https://www.example.com https://example.com".
const embedOrigins = process.env.EMBED_ORIGINS ?? "";

const nextConfig: NextConfig = {
  // The Growth sample data is read from disk when a manager loads it.
  outputFileTracingIncludes: { "/growth/[site]/data": ["./fixtures/growth/sample/*.csv"] },
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
