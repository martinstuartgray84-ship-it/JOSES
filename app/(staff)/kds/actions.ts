"use server";

import { db } from "@/src/server/db";
import { act, staffSite } from "@/src/server/guard";
import { readyItems, recallTicket, serveItems, setRush, startItems } from "@/src/server/kitchen";

type Which = string[] | "all";

const ids = (which: Which): Which => {
  if (which === "all") return which;
  if (!Array.isArray(which) || which.some((id) => !/^[0-9a-f-]{36}$/.test(id))) throw new Error("Bad item list");
  return which;
};

export async function startAction(siteSlug: string, ticketId: string, which: Which) {
  return act(async () => startItems(db(), await staffSite(siteSlug), ticketId, ids(which)));
}

export async function readyAction(siteSlug: string, ticketId: string, which: Which) {
  return act(async () => readyItems(db(), await staffSite(siteSlug), ticketId, ids(which)));
}

export async function serveAction(siteSlug: string, ticketId: string, which: Which) {
  return act(async () => serveItems(db(), await staffSite(siteSlug), ticketId, ids(which)));
}

export async function recallAction(siteSlug: string, ticketId: string) {
  return act(async () => recallTicket(db(), await staffSite(siteSlug), ticketId));
}

export async function rushAction(siteSlug: string, ticketId: string, rush: boolean) {
  return act(async () => setRush(db(), await staffSite(siteSlug), ticketId, rush));
}
