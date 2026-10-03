// Email delivery. Uses Resend when RESEND_API_KEY is set; otherwise messages
// are recorded as "logged" (saved, not sent) so nothing pretends to have gone out.

export interface OutgoingEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** RFC 8058 one-click unsubscribe endpoint. */
  unsubscribeUrl: string;
}

export interface DeliveryResult {
  status: "sent" | "failed" | "logged";
  providerId?: string;
  error?: string;
}

export function emailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY && !!process.env.EMAIL_FROM;
}

export function appUrl(): string {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

const BATCH = 100;

export async function deliver(messages: OutgoingEmail[]): Promise<DeliveryResult[]> {
  if (!emailConfigured()) return messages.map(() => ({ status: "logged" as const }));
  const results: DeliveryResult[] = [];
  for (let i = 0; i < messages.length; i += BATCH) {
    const chunk = messages.slice(i, i + BATCH);
    try {
      const r = await fetch("https://api.resend.com/emails/batch", {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify(
          chunk.map((m) => ({
            from: process.env.EMAIL_FROM,
            to: [m.to],
            subject: m.subject,
            html: m.html,
            text: m.text,
            headers: {
              "List-Unsubscribe": `<${m.unsubscribeUrl}>`,
              "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
            },
          })),
        ),
      });
      if (!r.ok) {
        const msg = `${r.status} ${(await r.text()).slice(0, 200)}`;
        results.push(...chunk.map(() => ({ status: "failed" as const, error: msg })));
        continue;
      }
      const body = (await r.json()) as { data?: { id: string }[] };
      results.push(...chunk.map((_, j) => ({ status: "sent" as const, providerId: body.data?.[j]?.id })));
    } catch (err) {
      results.push(...chunk.map(() => ({ status: "failed" as const, error: (err as Error).message })));
    }
  }
  return results;
}
