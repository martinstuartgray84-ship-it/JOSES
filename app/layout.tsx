import type { Metadata, Viewport } from "next";
import { isDemo } from "@/src/server/demo";
import "./globals.css";

export const metadata: Metadata = { title: { default: "Jose's", template: "%s · Jose's" } };
// Rendered per request, so the demo banner follows the running server's configuration, not the build's.
export const dynamic = "force-dynamic";
// The first request in demo mode builds the database, which takes a few seconds.
export const maxDuration = 60;
export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <body>
        {isDemo() && (
          <p className="demo-banner" role="note">
            <strong>Demonstration.</strong> The sales figures are invented samples, not this restaurant&rsquo;s own.
          </p>
        )}
        {children}
      </body>
    </html>
  );
}
