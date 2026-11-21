"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/src/server/db";
import { act, staffSite, type ActionResult } from "@/src/server/guard";
import { DAY_KEYS, clearData, finishImport, importChunk, loadSample, saveSettings, startImport, type ImportRecord, type ServerRole } from "@/src/server/growth";
import {
  addIdea, buildScorecard, createTest, decideTest, deleteEnquiry, deleteEvent, emailScorecard, markRead, recheckGain, runScorecards, saveBridge, saveEnquiry,
  saveEvent, setIdeaStatus, startTest,
} from "@/src/server/growth-programme";
import type { FileKind } from "@/src/growth/engine";
import { addAction, deleteMeeting, deleteTurnaway, editAction, loadStarter, logTurnaway, saveBet, saveDecision, saveMeeting, setActionStatus } from "@/src/server/growth-office";

// Every action re-checks the staff session and that the site belongs to this company.
async function venue(slug: string) {
  const site = await staffSite(slug);
  return { id: site.id, sql: db() };
}
// The site and programme names show in the bars above every page, so refresh from the top.
const done = (_slug: string) => revalidatePath("/", "layout");
const fields = (fd: FormData) => Object.fromEntries([...fd.entries()].map(([k, v]) => [k, typeof v === "string" ? v : ""]));

// --- data ---

export async function startImportAction(slug: string, input: { kind: FileKind; filename: string; headers: string[]; mapping: Record<string, string | null> }): Promise<ActionResult<string>> {
  return act(async () => {
    const v = await venue(slug);
    return startImport(v.sql, v.id, input);
  });
}
export async function importChunkAction(slug: string, importId: string, text: string): Promise<ActionResult<{ rowsRead: number; rowsSkipped: number }>> {
  return act(async () => {
    const v = await venue(slug);
    return importChunk(v.sql, v.id, importId, text);
  });
}
export async function finishImportAction(slug: string, importId: string, failed?: string): Promise<ActionResult<ImportRecord>> {
  return act(async () => {
    const v = await venue(slug);
    const r = await finishImport(v.sql, v.id, importId, { failed });
    // Last week's scorecard may have been waiting for this data.
    await runScorecards(v.sql, { venueId: v.id }).catch((e) => console.error("scorecard after import", e));
    done(slug);
    return JSON.parse(JSON.stringify(r)) as ImportRecord;
  });
}
export async function loadSampleAction(slug: string): Promise<ActionResult<void>> {
  return act(async () => {
    const v = await venue(slug);
    await loadSample(v.sql, v.id);
    done(slug);
  });
}
export async function clearDataAction(slug: string): Promise<ActionResult<void>> {
  return act(async () => {
    const v = await venue(slug);
    await clearData(v.sql, v.id);
    done(slug);
  });
}

export async function saveSettingsAction(slug: string, fd: FormData): Promise<ActionResult<void>> {
  return act(async () => {
    const v = await venue(slug);
    const f = fields(fd);
    const hours: Record<string, [string, string] | null> = {};
    for (const d of DAY_KEYS) hours[d] = f[`closed_${d}`] ? null : [f[`open_${d}`] || "12:00", f[`close_${d}`] || "23:00"];
    const names = fd.getAll("area_name").map(String);
    const captains = fd.getAll("area_captain").map(String);
    await saveSettings(v.sql, v.id, {
      programmeName: f.programmeName ?? "",
      siteName: f.siteName ?? "",
      seats: Number(f.seats),
      barSeats: f.barSeats === "" ? null : Number(f.barSeats),
      tradingHours: hours,
      serverFiguresMinRole: (f.serverFiguresMinRole || "manager") as ServerRole,
      gainAreas: names.map((name, i) => ({ name, captain: captains[i] ?? "" })),
      scorecardEmails: (f.scorecardEmails ?? "").split(/[\s,;]+/),
    });
    done(slug);
  });
}

// --- ideas, tests, gains ---

export async function addIdeaAction(slug: string, fd: FormData): Promise<ActionResult<void>> {
  return act(async () => {
    const v = await venue(slug);
    await addIdea(v.sql, v.id, fields(fd) as never);
    done(slug);
  });
}
export async function ideaStatusAction(slug: string, ideaId: string, status: "open" | "declined"): Promise<ActionResult<void>> {
  return act(async () => {
    const v = await venue(slug);
    await setIdeaStatus(v.sql, v.id, ideaId, status);
    done(slug);
  });
}
export async function createTestAction(slug: string, fd: FormData): Promise<ActionResult<void>> {
  return act(async () => {
    const v = await venue(slug);
    const f = fields(fd);
    await createTest(v.sql, v.id, { ...f, live: f.live === "1" } as never);
    done(slug);
  });
}
export async function startTestAction(slug: string, testId: string): Promise<ActionResult<void>> {
  return act(async () => {
    const v = await venue(slug);
    await startTest(v.sql, v.id, testId);
    done(slug);
  });
}
export async function readTestAction(slug: string, testId: string): Promise<ActionResult<void>> {
  return act(async () => {
    const v = await venue(slug);
    await markRead(v.sql, v.id, testId);
    done(slug);
  });
}
export async function decideTestAction(slug: string, testId: string, decision: "bank" | "stop", fd: FormData): Promise<ActionResult<void>> {
  return act(async () => {
    const v = await venue(slug);
    const f = fields(fd);
    await decideTest(v.sql, v.id, testId, { decision, decidedBy: f.decidedBy, yearlyValue: f.yearlyValue, notes: f.notes });
    done(slug);
  });
}
export async function recheckGainAction(slug: string, gainId: string, holding: boolean): Promise<ActionResult<void>> {
  return act(async () => {
    const v = await venue(slug);
    await recheckGain(v.sql, v.id, gainId, holding);
    done(slug);
  });
}

// --- bridge, scorecard, events ---

export async function saveBridgeAction(slug: string, input: Record<string, number> | null): Promise<ActionResult<void>> {
  return act(async () => {
    const v = await venue(slug);
    await saveBridge(v.sql, v.id, input);
    done(slug);
  });
}
export async function buildScorecardAction(slug: string, fd: FormData): Promise<ActionResult<void>> {
  return act(async () => {
    const v = await venue(slug);
    if (!(await buildScorecard(v.sql, v.id, String(fd.get("week"))))) throw new Error("No sales are loaded for that week.");
    done(slug);
  });
}
export async function emailScorecardAction(slug: string, week: string): Promise<ActionResult<string>> {
  return act(async () => {
    const v = await venue(slug);
    const r = await emailScorecard(v.sql, v.id, week);
    done(slug);
    if (r.status === "no_recipients") throw new Error("Add the managers' email addresses under Settings first.");
    return r.status === "logged" ? "Email is not set up on this deployment, so nothing was sent." : `Sent to ${r.to.join(", ")}.`;
  });
}
export async function saveEnquiryAction(slug: string, fd: FormData): Promise<ActionResult<void>> {
  return act(async () => {
    const v = await venue(slug);
    await saveEnquiry(v.sql, v.id, fields(fd));
    done(slug);
  });
}
export async function deleteEnquiryAction(slug: string, enquiryId: string): Promise<ActionResult<void>> {
  return act(async () => {
    const v = await venue(slug);
    await deleteEnquiry(v.sql, v.id, enquiryId);
    done(slug);
  });
}
export async function saveEventAction(slug: string, fd: FormData): Promise<ActionResult<void>> {
  return act(async () => {
    const v = await venue(slug);
    await saveEvent(v.sql, v.id, fields(fd));
    done(slug);
  });
}
export async function deleteEventAction(slug: string, eventId: string): Promise<ActionResult<void>> {
  return act(async () => {
    const v = await venue(slug);
    await deleteEvent(v.sql, v.id, eventId);
    done(slug);
  });
}

// --- programme office ---


export async function loadStarterAction(slug: string): Promise<ActionResult<string>> {
  return act(async () => {
    const v = await venue(slug);
    const n = await loadStarter(v.sql, v.id);
    done(slug);
    return `Added ${n.actions} actions, ${n.decisions} decisions, ${n.ideas} ideas and ${n.bets} bet charters.`;
  });
}
export async function addActionAction(slug: string, fd: FormData): Promise<ActionResult<void>> {
  return act(async () => {
    const v = await venue(slug);
    await addAction(v.sql, v.id, fields(fd));
    done(slug);
  });
}
export async function actionStatusAction(slug: string, actionId: string, status: "open" | "done" | "dropped"): Promise<ActionResult<void>> {
  return act(async () => {
    const v = await venue(slug);
    await setActionStatus(v.sql, v.id, actionId, status);
    done(slug);
  });
}
export async function editActionAction(slug: string, actionId: string, fd: FormData): Promise<ActionResult<void>> {
  return act(async () => {
    const v = await venue(slug);
    await editAction(v.sql, v.id, actionId, fields(fd));
    done(slug);
  });
}
export async function saveDecisionAction(slug: string, fd: FormData): Promise<ActionResult<void>> {
  return act(async () => {
    const v = await venue(slug);
    await saveDecision(v.sql, v.id, fields(fd));
    done(slug);
  });
}
export async function saveBetAction(slug: string, fd: FormData): Promise<ActionResult<void>> {
  return act(async () => {
    const v = await venue(slug);
    await saveBet(v.sql, v.id, fields(fd));
    done(slug);
  });
}
export async function saveMeetingAction(slug: string, fd: FormData): Promise<ActionResult<void>> {
  return act(async () => {
    const v = await venue(slug);
    await saveMeeting(v.sql, v.id, fields(fd));
    done(slug);
  });
}
export async function deleteMeetingAction(slug: string, meetingId: string): Promise<ActionResult<void>> {
  return act(async () => {
    const v = await venue(slug);
    await deleteMeeting(v.sql, v.id, meetingId);
    done(slug);
  });
}
export async function logTurnawayAction(slug: string, fd: FormData): Promise<ActionResult<void>> {
  return act(async () => {
    const v = await venue(slug);
    await logTurnaway(v.sql, v.id, fields(fd));
    done(slug);
  });
}
export async function deleteTurnawayAction(slug: string, turnawayId: string): Promise<ActionResult<void>> {
  return act(async () => {
    const v = await venue(slug);
    await deleteTurnaway(v.sql, v.id, turnawayId);
    done(slug);
  });
}
