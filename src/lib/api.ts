// Shapes shared by the API routes and the booking widget.
import { z } from "zod";

export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .refine((d) => {
    const t = Date.parse(`${d}T00:00:00Z`);
    return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === d;
  }, "That date doesn't exist");

export const availabilityQuery = z.object({
  site: z.string().min(1),
  date: isoDate,
  covers: z.coerce.number().int().min(1).max(50),
});

export const createBookingBody = z.object({
  site: z.string().min(1),
  date: isoDate,
  serviceId: z.uuid(),
  time: z.number().int().min(0).max(48 * 60),
  covers: z.number().int().min(1).max(50),
  guest: z
    .object({
      firstName: z.string().trim().min(1).max(100),
      lastName: z.string().trim().max(100).optional(),
      email: z.email().max(254).optional(),
      phone: z.string().trim().regex(/^\+?[\d\s()-]{7,20}$/, "Enter a valid phone number").optional(),
      marketingOptIn: z.boolean().optional(),
    })
    .refine((g) => g.email || g.phone, "Give an email or phone number so we can confirm"),
  specialRequests: z.string().trim().max(500).optional(),
});
export type CreateBookingBody = z.infer<typeof createBookingBody>;

export interface PublicSlot {
  serviceId: string;
  serviceName: string;
  time: number;
}

export interface AvailabilityResponse {
  site: { slug: string; name: string };
  date: string;
  slots: PublicSlot[];
}

export interface BookingCreatedResponse {
  manageToken: string;
  startsAt: string;
}

export interface ApiError {
  error: string;
  code?: string;
}

/** First validation problem as a readable sentence, e.g. "guest.email: Invalid email address". */
export function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "Invalid request";
  return issue.path.length ? `${issue.path.join(".")}: ${issue.message}` : issue.message;
}

export const formatTime = (minutes: number) => {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};
