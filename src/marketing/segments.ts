// Guest segments: who a campaign goes to, or who a list shows.
// Pure: validation and plain-English descriptions. The server turns a segment into SQL.

import { z } from "zod";

export const segmentSchema = z
  .object({
    minVisits: z.number().int().min(0).max(1000).optional(),
    maxVisits: z.number().int().min(0).max(1000).optional(),
    /** Last visit at least this many days ago (lapsed). */
    lastVisitDaysAgoMin: z.number().int().min(0).max(3650).optional(),
    /** Last visit within this many days (recent). */
    lastVisitDaysAgoMax: z.number().int().min(0).max(3650).optional(),
    /** Total spend ever, pence. */
    minSpend: z.number().int().min(0).optional(),
    /** Visited this site at least once. */
    siteId: z.uuid().optional(),
    birthdayThisMonth: z.boolean().optional(),
    tag: z.string().trim().min(1).max(40).optional(),
    hasNoShow: z.boolean().optional(),
  })
  .strict()
  .refine((s) => s.minVisits === undefined || s.maxVisits === undefined || s.minVisits <= s.maxVisits, {
    message: "Minimum visits can't be more than maximum",
  })
  .refine(
    (s) => s.lastVisitDaysAgoMin === undefined || s.lastVisitDaysAgoMax === undefined || s.lastVisitDaysAgoMin <= s.lastVisitDaysAgoMax,
    { message: "Those last-visit days don't overlap" },
  );

export type Segment = z.infer<typeof segmentSchema>;

export interface Preset {
  key: string;
  label: string;
  why: string;
  segment: Segment;
}

export const PRESETS: Preset[] = [
  { key: "all", label: "Everyone", why: "Every guest who's said yes to news.", segment: {} },
  {
    key: "regulars",
    label: "Regulars",
    why: "Five or more visits. Thank them first; they're most of your repeat revenue.",
    segment: { minVisits: 5 },
  },
  {
    key: "lapsed",
    label: "Lapsed regulars",
    why: "Came three or more times but not in the last 45 days. The cheapest covers you'll win back.",
    segment: { minVisits: 3, lastVisitDaysAgoMin: 45 },
  },
  {
    key: "one-timers",
    label: "Came once",
    why: "One visit in the last 60 days. A second visit is the hardest and most valuable.",
    segment: { minVisits: 1, maxVisits: 1, lastVisitDaysAgoMax: 60 },
  },
  {
    key: "big-spenders",
    label: "Big spenders",
    why: "£300 or more over time. Good for events, wine dinners and private hire.",
    segment: { minSpend: 30000 },
  },
  { key: "birthdays", label: "Birthdays this month", why: "Birthday in the current month.", segment: { birthdayThisMonth: true } },
  { key: "no-shows", label: "Past no-shows", why: "Missed a booking before. Ask for a card next time.", segment: { hasNoShow: true } },
];

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const pounds = (p: number) => `£${(p / 100).toLocaleString("en-GB", { maximumFractionDigits: 0 })}`;

/** "Guests with 3+ visits, last seen 45+ days ago, who visited Site One." */
export function describeSegment(s: Segment, siteName?: (id: string) => string | undefined): string {
  const parts: string[] = [];
  if (s.minVisits !== undefined && s.maxVisits !== undefined) {
    parts.push(s.minVisits === s.maxVisits ? `exactly ${plural(s.minVisits, "visit")}` : `${s.minVisits}–${s.maxVisits} visits`);
  } else if (s.minVisits !== undefined && s.minVisits > 0) parts.push(`${s.minVisits}+ visits`);
  else if (s.maxVisits !== undefined) parts.push(`at most ${plural(s.maxVisits, "visit")}`);
  if (s.lastVisitDaysAgoMin !== undefined && s.lastVisitDaysAgoMax !== undefined) {
    parts.push(`last seen ${s.lastVisitDaysAgoMin}–${s.lastVisitDaysAgoMax} days ago`);
  } else if (s.lastVisitDaysAgoMin !== undefined) parts.push(`not seen for ${s.lastVisitDaysAgoMin}+ days`);
  else if (s.lastVisitDaysAgoMax !== undefined) parts.push(`seen in the last ${plural(s.lastVisitDaysAgoMax, "day")}`);
  if (s.minSpend !== undefined && s.minSpend > 0) parts.push(`${pounds(s.minSpend)}+ spent`);
  if (s.siteId) parts.push(`visited ${siteName?.(s.siteId) ?? "the chosen site"}`);
  if (s.birthdayThisMonth) parts.push("birthday this month");
  if (s.tag) parts.push(`tagged "${s.tag}"`);
  if (s.hasNoShow) parts.push("missed a booking before");
  return parts.length ? `Guests with ${parts.join(", ")}` : "All guests";
}
