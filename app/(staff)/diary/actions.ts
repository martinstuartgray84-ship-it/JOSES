"use server";

import { revalidatePath } from "next/cache";
import { BookingError, createBooking, createWalkIn, siteAvailability } from "@/src/server/booking";
import { db } from "@/src/server/db";
import { setBookingStatus, StatusError, type DiaryStatus } from "@/src/server/diary";
import { endStaffSession, isStaff } from "@/src/server/staff";
import { trySendBookingEmail } from "@/src/server/notify";
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
    if (to === "cancelled") await trySendBookingEmail(db(), bookingId, "cancellation");
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

// --- New bookings and walk-ins from the diary --------------------------------


type Guest = { firstName: string; lastName?: string; email?: string; phone?: string };

const cleanGuest = (g: Guest): Guest => ({
  firstName: g.firstName.trim().slice(0, 100),
  lastName: g.lastName?.trim().slice(0, 100) || undefined,
  email: g.email?.trim().slice(0, 254) || undefined,
  phone: g.phone?.trim().slice(0, 30) || undefined,
});

export async function staffSlots(siteSlug: string, date: string, covers: number) {
  if (!(await isStaff())) return { ok: false as const, error: "Your session has expired. Please sign in again." };
  try {
    const { slots } = await siteAvailability(db(), siteSlug, date, covers, { channel: "phone" });
    return {
      ok: true as const,
      slots: slots.filter((s) => s.available).map((s) => ({ serviceId: s.serviceId, time: s.time })),
    };
  } catch (err) {
    if (err instanceof BookingError) return { ok: false as const, error: err.message };
    throw err;
  }
}

export async function staffBook(
  siteSlug: string,
  input: { date: string; serviceId: string; time: number; covers: number; guest: Guest; notes?: string },
) {
  if (!(await isStaff())) return { ok: false as const, error: "Your session has expired. Please sign in again." };
  const guest = cleanGuest(input.guest);
  if (!guest.firstName) return { ok: false as const, error: "Add the guest's name" };
  if (guest.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guest.email)) return { ok: false as const, error: "That email doesn't look right" };
  try {
    const b = await createBooking(db(), {
      siteSlug,
      date: input.date,
      serviceId: input.serviceId,
      time: input.time,
      covers: input.covers,
      guest,
      channel: "phone",
      specialRequests: input.notes?.trim().slice(0, 500) || undefined,
    });
    await trySendBookingEmail(db(), b.id, "confirmation");
    revalidatePath(`/diary/${siteSlug}`);
    return { ok: true as const };
  } catch (err) {
    if (err instanceof BookingError) return { ok: false as const, error: err.message };
    throw err;
  }
}

export async function walkIn(siteSlug: string, input: { covers: number; tableId?: string | null; guest?: Guest | null }) {
  if (!(await isStaff())) return { ok: false as const, error: "Your session has expired. Please sign in again." };
  try {
    const guest = input.guest && (input.guest.firstName || input.guest.phone || input.guest.email) ? cleanGuest(input.guest) : null;
    await createWalkIn(db(), { siteSlug, covers: input.covers, tableId: input.tableId || null, guest });
    revalidatePath(`/diary/${siteSlug}`);
    return { ok: true as const };
  } catch (err) {
    if (err instanceof BookingError) return { ok: false as const, error: err.message };
    throw err;
  }
}
