"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/src/server/db";
import { setBookingStatus, StatusError, type DiaryStatus } from "@/src/server/diary";
import { endStaffSession, isStaff } from "@/src/server/staff";
import { redirect } from "next/navigation";

const STATUSES: DiaryStatus[] = ["pending", "confirmed", "seated", "completed", "cancelled", "no_show"];

export async function updateStatus(
  siteSlug: string,
  bookingId: string,
  to: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  // Server actions are public endpoints: check the session here, not just on the page.
  if (!(await isStaff())) return { ok: false, error: "Your session has expired. Please sign in again." };
  if (!STATUSES.includes(to as DiaryStatus)) return { ok: false, error: "Unknown status" };
  try {
    await setBookingStatus(db(), siteSlug, bookingId, to as DiaryStatus);
  } catch (err) {
    if (err instanceof StatusError) return { ok: false, error: err.message };
    throw err;
  }
  revalidatePath(`/diary/${siteSlug}`);
  return { ok: true };
}

export async function signOut() {
  await endStaffSession();
  redirect("/staff/login");
}
