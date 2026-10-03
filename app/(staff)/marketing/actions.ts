"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/src/server/db";
import { act, staffCompany } from "@/src/server/guard";
import {
  deleteDraft,
  parseSegment,
  runAutomations,
  saveAutomation,
  saveCampaign,
  segmentAudience,
  sendCampaign,
  sendTest,
  type AutomationKind,
} from "@/src/server/marketing";

export async function audienceAction(segment: unknown) {
  return act(async () => {
    const c = await staffCompany();
    return segmentAudience(db(), c.id, parseSegment(segment));
  });
}

export async function saveCampaignAction(input: { id?: string; name: string; subject: string; body: string; segment: unknown }) {
  return act(async () => {
    const c = await staffCompany();
    const id = await saveCampaign(db(), c.id, { ...input, segment: parseSegment(input.segment) });
    revalidatePath("/marketing");
    return id;
  });
}

export async function sendCampaignAction(input: { id?: string; name: string; subject: string; body: string; segment: unknown }) {
  return act(async () => {
    const c = await staffCompany();
    const id = await saveCampaign(db(), c.id, { ...input, segment: parseSegment(input.segment) });
    const r = await sendCampaign(db(), c.id, id);
    revalidatePath("/marketing");
    return r;
  });
}

export async function sendTestAction(input: { subject: string; body: string; to: string }) {
  return act(async () => {
    const c = await staffCompany();
    const r = await sendTest(db(), c.id, input);
    return { status: r.status, error: r.error };
  });
}

export async function deleteDraftAction(id: string) {
  return act(async () => {
    const c = await staffCompany();
    await deleteDraft(db(), c.id, id);
    revalidatePath("/marketing");
  });
}

export async function saveAutomationAction(kind: AutomationKind, input: { enabled: boolean; subject: string; body: string; params: Record<string, number> }) {
  return act(async () => {
    if (!["winback", "thank_you", "birthday"].includes(kind)) throw new Error("Unknown automation");
    const c = await staffCompany();
    await saveAutomation(db(), c.id, kind, input);
    revalidatePath("/marketing");
  });
}

export async function runAutomationsAction() {
  return act(async () => {
    const c = await staffCompany();
    const r = await runAutomations(db(), c.id);
    revalidatePath("/marketing");
    return r;
  });
}
