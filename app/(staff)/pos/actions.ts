"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/src/server/db";
import { act, staffSite } from "@/src/server/guard";
import { serveOrder } from "@/src/server/kitchen";
import {
  addItem,
  compItem,
  moveOrder,
  openOrder,
  OrderError,
  removeItem,
  sendItems,
  setCovers,
  setDiscount,
  setServiceCharge,
  closeZeroCheck,
  takePayment,
  updateHeldItem,
  verifyPin,
  voidOrder,
} from "@/src/server/orders";
import { clearTillUser, setTillUser, tillUserId } from "@/src/server/staff";

/** Every till action needs the shared sign-in and a staff member on the till. */
async function till(siteSlug: string) {
  const site = await staffSite(siteSlug);
  const staffId = await tillUserId();
  if (!staffId) throw new OrderError("pin", "Sign in on the till with your PIN first");
  return { site, staffId };
}

const refresh = (siteSlug: string, orderId?: string) => {
  revalidatePath(`/pos/${siteSlug}`);
  if (orderId) revalidatePath(`/pos/${siteSlug}/check/${orderId}`);
};

export async function pinSignIn(siteSlug: string, staffId: string, pin: string) {
  return act(async () => {
    const site = await staffSite(siteSlug);
    const s = await verifyPin(db(), site.companyId, staffId, pin);
    await setTillUser(s.id);
    return s.name;
  });
}

export async function pinSignOut() {
  await clearTillUser();
}

export async function openCheck(siteSlug: string, input: { tableId?: string; label?: string; covers: number; bookingId?: string }) {
  return act(async () => {
    const { site, staffId } = await till(siteSlug);
    const id = await openOrder(db(), site, { ...input, staffId });
    refresh(siteSlug);
    return id;
  });
}

export async function addToCheck(
  siteSlug: string,
  orderId: string,
  input: { menuItemId: string; quantity?: number; optionIds?: string[]; seat?: number | null; course?: number | null; notes?: string | null },
) {
  return act(async () => {
    const { site, staffId } = await till(siteSlug);
    await addItem(db(), site, orderId, { ...input, staffId });
    refresh(siteSlug, orderId);
  });
}

export async function changeItem(siteSlug: string, orderId: string, itemId: string, patch: { quantity?: number; seat?: number | null; course?: number; notes?: string | null }) {
  return act(async () => {
    const { site } = await till(siteSlug);
    await updateHeldItem(db(), site, itemId, patch);
    refresh(siteSlug, orderId);
  });
}

export async function deleteItem(siteSlug: string, orderId: string, itemId: string, reason?: string) {
  return act(async () => {
    const { site } = await till(siteSlug);
    await removeItem(db(), site, itemId, reason);
    refresh(siteSlug, orderId);
  });
}

export async function compCheckItem(siteSlug: string, orderId: string, itemId: string, reason: string | null) {
  return act(async () => {
    const { site } = await till(siteSlug);
    await compItem(db(), site, itemId, reason);
    refresh(siteSlug, orderId);
  });
}

export async function send(siteSlug: string, orderId: string, courses: { upTo: number } | { only: number[] }) {
  return act(async () => {
    const { site } = await till(siteSlug);
    const n = await sendItems(db(), site, orderId, courses);
    refresh(siteSlug, orderId);
    return n;
  });
}

export async function markServed(siteSlug: string, orderId: string) {
  return act(async () => {
    const { site } = await till(siteSlug);
    await serveOrder(db(), site, orderId);
    refresh(siteSlug, orderId);
  });
}

export async function applyDiscount(siteSlug: string, orderId: string, d: { kind: "percent" | "amount"; value: number; reason: string } | null) {
  return act(async () => {
    const { site } = await till(siteSlug);
    await setDiscount(db(), site, orderId, d);
    refresh(siteSlug, orderId);
  });
}

export async function applyServiceCharge(siteSlug: string, orderId: string, pct: number) {
  return act(async () => {
    const { site } = await till(siteSlug);
    await setServiceCharge(db(), site, orderId, pct);
    refresh(siteSlug, orderId);
  });
}

export async function changeCovers(siteSlug: string, orderId: string, covers: number) {
  return act(async () => {
    const { site } = await till(siteSlug);
    await setCovers(db(), site, orderId, covers);
    refresh(siteSlug, orderId);
  });
}

export async function pay(
  siteSlug: string,
  orderId: string,
  input: { method: "card" | "cash" | "voucher" | "other"; amount: number; tip: number },
) {
  return act(async () => {
    const { site, staffId } = await till(siteSlug);
    const r = await takePayment(db(), site, orderId, { ...input, staffId });
    refresh(siteSlug, orderId);
    return r;
  });
}

export async function closeFree(siteSlug: string, orderId: string) {
  return act(async () => {
    const { site } = await till(siteSlug);
    await closeZeroCheck(db(), site, orderId);
    refresh(siteSlug, orderId);
  });
}

export async function voidCheck(siteSlug: string, orderId: string, reason: string) {
  return act(async () => {
    const { site } = await till(siteSlug);
    await voidOrder(db(), site, orderId, reason);
    refresh(siteSlug, orderId);
  });
}

export async function moveCheck(siteSlug: string, orderId: string, tableId: string) {
  return act(async () => {
    const { site } = await till(siteSlug);
    await moveOrder(db(), site, orderId, tableId);
    refresh(siteSlug, orderId);
  });
}
