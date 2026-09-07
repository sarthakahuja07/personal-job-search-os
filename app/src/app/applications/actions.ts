"use server";

import { revalidatePath } from "next/cache";

import { getDb } from "@/db";
import { isStage } from "@/server/domain/applications";
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
