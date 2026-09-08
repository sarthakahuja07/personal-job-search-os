"use server";

import { revalidatePath } from "next/cache";

import { getDb } from "@/db";
import { isStage } from "@/server/domain/applications";
import { addManualJob } from "@/server/service/manual-job";
import * as repo from "@/server/repository/applications-repo";

/** Revalidate everywhere a stage is visible, so the board, job list and dashboard agree. */
function revalidateAll() {
  revalidatePath("/applications");
  revalidatePath("/jobs");
  revalidatePath("/");
}

export async function moveCard(applicationId: string, jobId: string, companyId: string, stage: string) {
  // Validate against the known set rather than trusting the caller: an unknown stage would
  // render as an empty column that no card could ever be dragged out of.
  if (!isStage(stage)) throw new Error(`unknown stage: ${stage}`);
  await repo.setStage(getDb(), jobId, companyId, stage);
  revalidateAll();
}

export async function saveNotes(applicationId: string, notes: string) {
  await repo.updateNotes(getDb(), applicationId, notes.trim() || null);
  revalidatePath("/applications");
}

export async function removeCard(applicationId: string) {
  await repo.remove(getDb(), applicationId);
  revalidateAll();
}

/** Used from the job board and job detail page to pull a role into the pipeline. */
export async function addToPipeline(jobId: string, companyId: string, stage: string) {
  if (!isStage(stage)) throw new Error(`unknown stage: ${stage}`);
  await repo.setStage(getDb(), jobId, companyId, stage);
  revalidateAll();
  revalidatePath(`/jobs/${jobId}`);
}

/**
 * Add a job from nothing but its link, and drop it straight onto the board.
 *
 * The two steps are deliberately one action: a job added without a stage would sit in the job
 * list and never reach the board, which is the opposite of why you pasted the link.
 */
export async function addJobByLink(formData: FormData): Promise<{ error?: string }> {
  const stage = String(formData.get("stage") ?? "saved");
  if (!isStage(stage)) return { error: `Unknown stage: ${stage}` };

  const db = getDb();
  const result = await addManualJob(db, {
    jobUrl: String(formData.get("jobUrl") ?? ""),
    title: String(formData.get("title") ?? ""),
    companyId: String(formData.get("companyId") ?? "") || undefined,
    companyName: String(formData.get("companyName") ?? "") || undefined,
    location: String(formData.get("location") ?? "") || undefined,
  });

  if (!result.ok) return { error: result.error };

  await repo.setStage(db, result.jobId, result.companyId, stage);
  revalidateAll();
  revalidatePath("/reminders");
  revalidatePath(`/jobs/${result.jobId}`);
  return {};
}
