"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/src/server/db";
import { act, staffCompany } from "@/src/server/guard";
import { updateGuest } from "@/src/server/crm";

const patchSchema = z
  .object({
    firstName: z.string().max(100),
    lastName: z.string().max(100).nullable(),
    email: z.union([z.email().max(254), z.literal("")]).nullable(),
    phone: z.string().max(30).nullable(),
    notes: z.string().max(2000).nullable(),
    allergies: z.string().max(500).nullable(),
    tags: z.array(z.string().max(40)).max(20),
    birthdayMonth: z.number().int().min(1).max(12).nullable(),
    birthdayDay: z.number().int().min(1).max(31).nullable(),
    marketingOptIn: z.boolean(),
  })
  .partial();

export async function saveGuest(guestId: string, patch: z.infer<typeof patchSchema>, consentSource?: string) {
  return act(async () => {
    const company = await staffCompany();
    const parsed = patchSchema.safeParse(patch);
    if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Check the form");
    await updateGuest(db(), company.id, guestId, parsed.data, consentSource?.trim() || "staff");
    revalidatePath(`/guests/${guestId}`);
    revalidatePath("/guests");
  });
}
