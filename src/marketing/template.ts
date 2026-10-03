// Email templates: plain text with {{placeholders}} and blank-line paragraphs,
// rendered to both HTML and text. Guest data is escaped; staff-written text is
// escaped too (no raw HTML), with **bold** and bare links supported.

export interface TemplateData {
  first_name: string;
  last_name?: string;
  company: string;
  /** Most-visited site, or the company name. */
  site: string;
  /** Booking page link. */
  book_url: string;
}

export const PLACEHOLDERS: { key: keyof TemplateData; label: string }[] = [
  { key: "first_name", label: "First name" },
  { key: "site", label: "Their usual site" },
  { key: "book_url", label: "Booking link" },
  { key: "company", label: "Company name" },
];

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export function fill(template: string, data: TemplateData): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, key: string) => {
    const v = (data as unknown as Record<string, string | undefined>)[key];
    return v === undefined ? m : v || (key === "first_name" ? "there" : "");
  });
}

/** Placeholders the template uses that we don't know. */
export function unknownPlaceholders(template: string): string[] {
  const known = new Set(PLACEHOLDERS.map((p) => p.key as string).concat("last_name"));
  return [...new Set([...template.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]!).filter((k) => !known.has(k)))];
}

function inline(textEscaped: string): string {
  return textEscaped
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)])/g, '<a href="$1">$1</a>');
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export function renderEmail(input: {
  subject: string;
  body: string;
  data: TemplateData;
  unsubscribeUrl: string;
  openPixelUrl?: string;
  footer: string;
}): RenderedEmail {
  // Fill first, then escape: guest names can't inject markup.
  const subject = fill(input.subject, input.data).replace(/[\r\n]+/g, " ").trim();
  const filled = fill(input.body, input.data).replace(/\r\n?/g, "\n").trim();
  const paragraphs = filled.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const htmlParas = paragraphs.map((p) => `<p style="margin:0 0 16px">${inline(escapeHtml(p)).replace(/\n/g, "<br>")}</p>`).join("");
  const footer = escapeHtml(input.footer);
  const unsub = escapeHtml(input.unsubscribeUrl);
  const html =
    `<!doctype html><html><body style="margin:0;padding:24px;background:#f7f4ef;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1f1b16">` +
    `<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:10px;padding:28px;font-size:16px;line-height:1.5">${htmlParas}</div>` +
    `<p style="max-width:560px;margin:16px auto 0;font-size:12px;color:#6b635a;text-align:center">${footer}<br>` +
    `<a href="${unsub}" style="color:#6b635a">Unsubscribe</a> from these emails.</p>` +
    (input.openPixelUrl ? `<img src="${escapeHtml(input.openPixelUrl)}" width="1" height="1" alt="" style="display:block">` : "") +
    `</body></html>`;
  const text = `${paragraphs.join("\n\n").replace(/\*\*(.+?)\*\*/g, "$1")}\n\n--\n${input.footer}\nUnsubscribe: ${input.unsubscribeUrl}\n`;
  return { subject, html, text };
}

/**
 * Transactional email (booking confirmations and reminders): no marketing
 * footer, an optional button, every value escaped.
 */
export function renderTransactional(input: {
  subject: string;
  heading: string;
  lines: string[];
  details: [string, string][];
  button?: { label: string; url: string };
  footer: string;
}): RenderedEmail {
  const rows = input.details
    .map(([k, v]) => `<tr><td style="padding:4px 16px 4px 0;color:#6b635a">${escapeHtml(k)}</td><td style="padding:4px 0;font-weight:600">${escapeHtml(v)}</td></tr>`)
    .join("");
  const button = input.button
    ? `<p style="margin:20px 0 0"><a href="${escapeHtml(input.button.url)}" style="display:inline-block;background:#8c2f1b;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:600">${escapeHtml(input.button.label)}</a></p>`
    : "";
  const html =
    `<!doctype html><html><body style="margin:0;padding:24px;background:#f7f4ef;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1f1b16">` +
    `<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:10px;padding:28px;font-size:16px;line-height:1.5">` +
    `<h1 style="margin:0 0 12px;font-size:22px">${escapeHtml(input.heading)}</h1>` +
    input.lines.map((l) => `<p style="margin:0 0 12px">${escapeHtml(l)}</p>`).join("") +
    `<table style="border-collapse:collapse;margin:8px 0 0">${rows}</table>${button}</div>` +
    `<p style="max-width:520px;margin:16px auto 0;font-size:12px;color:#6b635a;text-align:center">${escapeHtml(input.footer)}</p>` +
    `</body></html>`;
  const text = [
    input.heading,
    "",
    ...input.lines,
    "",
    ...input.details.map(([k, v]) => `${k}: ${v}`),
    ...(input.button ? ["", `${input.button.label}: ${input.button.url}`] : []),
    "",
    "--",
    input.footer,
  ].join("\n");
  return { subject: input.subject.replace(/[\r\n]+/g, " ").trim(), html, text };
}
