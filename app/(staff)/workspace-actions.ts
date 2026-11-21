"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/src/server/db";
import { demoSeed, demoState, isDemo, setDemoRev } from "@/src/server/demo";
import { act, staffCompany, type ActionResult } from "@/src/server/guard";
import { exportWorkspace, importWorkspace, WorkspaceError } from "@/src/server/workspace";

/** The programme's data as a backup document (JSON text). */
export async function exportWorkspaceAction(): Promise<ActionResult<string>> {
  return act(async () => {
    const c = await staffCompany();
    return JSON.stringify(await exportWorkspace(db(), c.id));
  });
}

/**
 * Replace the programme's data with a backup. In demo mode `rev` is the
 * revision of the browser's copy, carried over so copies can be compared.
 */
export async function importWorkspaceAction(json: string, rev?: number): Promise<ActionResult<{ rows: number; skipped: number; bootId?: string; rev?: number }>> {
  return act(async () => {
    const c = await staffCompany();
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      throw new Error("That file is not a programme backup from this app.");
    }
    let r: { rows: number; skipped: number };
    try {
      r = await importWorkspace(db(), c.id, parsed);
    } catch (e) {
      if (e instanceof WorkspaceError) throw new Error(e.message);
      throw e;
    }
    revalidatePath("/", "layout");
    if (!isDemo()) return r;
    if (rev != null) await setDemoRev(db(), rev);
    return { ...r, ...(await demoState(db())) };
  });
}

/** Demo mode only: put the programme back to the sample it started with. */
export async function resetDemoAction(): Promise<ActionResult<void>> {
  return act(async () => {
    if (!isDemo()) throw new Error("Only the demo can be reset.");
    const c = await staffCompany();
    await demoState(db()); // makes sure the database has started, so the seed is loaded
    const seed = demoSeed();
    if (!seed) throw new Error("The demo's starting data is not available. Reload the page and try again.");
    await importWorkspace(db(), c.id, JSON.parse(seed));
    revalidatePath("/", "layout");
  });
}
