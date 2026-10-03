import type { NextConfig } from "next";

// Sites allowed to embed the booking widget in an iframe, space-separated,
// e.g. "https://www.example.com https://example.com".
const embedOrigins = process.env.EMBED_ORIGINS ?? "";

const nextConfig: NextConfig = {
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
