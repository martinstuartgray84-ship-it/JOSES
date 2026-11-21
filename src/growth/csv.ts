// CSV text to rows keyed by header. Reuses the menu importer's RFC 4180 reader.
import { parseDelimited } from "@/src/menu/import";
import type { RawRow } from "./engine";

export function csvRows(text: string): { headers: string[]; rows: RawRow[] } {
  const [head, ...lines] = parseDelimited(text);
  const headers = (head ?? []).map((h) => h.trim());
  return { headers, rows: lines.map((l) => toRow(headers, l)) };
}
export function toRow(headers: string[], cells: string[]): RawRow {
  const o: RawRow = {};
  headers.forEach((h, i) => (o[h] = cells[i] ?? ""));
  return o;
}
/** Rows of cells from text that has no header line (a later chunk of a large file). */
export const csvCells = (text: string): string[][] => parseDelimited(text);
