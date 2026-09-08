"use server";

import { eq, inArray, isNull, and } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { getDb } from "@/db";
import { jobs } from "@/db/schema";

/** A read mark shows up on the board, the dashboard and the job page alike. */
function revalidateAll(jobId?: string) {
  revalidatePath("/jobs");
  revalidatePath("/");
  if (jobId) revalidatePath(`/jobs/${jobId}`);
}

/**
 * Mark a job as read, or unmark it.
 *
 * "Read" means seen and consciously passed over — deliberately not the same as closing the job
 * (the posting is gone) or moving it into the pipeline (you acted on it). It exists so the
 * board can tell the difference between fifty roles you have already considered and the three
 * that arrived overnight, which is the only reason a daily list stays readable.
 */
export async function setJobRead(jobId: string, read: boolean) {
  await getDb()
    .update(jobs)
    .set({ readAt: read ? new Date() : null, updatedAt: new Date() })
    .where(eq(jobs.id, jobId));
  revalidateAll(jobId);
}

/**
 * Mark every currently-open, relevant job at one company as read.
 *
 * Reviewing happens per company — you scan Amazon's fourteen roles in one pass — so clearing
 * them one at a time is busywork the group header can absorb.
 */
export async function markCompanyRead(companyId: string) {
  await getDb()
    .update(jobs)
    .set({ readAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(jobs.companyId, companyId),
        eq(jobs.isRelevant, true),
        isNull(jobs.closedAt),
        isNull(jobs.readAt),
      ),
    );
  revalidateAll();
}

/** Used by the "mark all read" affordance on a filtered view. */
export async function markManyRead(jobIds: string[]) {
  if (!jobIds.length) return;
  // D1 caps bound parameters at 100; the id list is chunked well inside that.
  for (let i = 0; i < jobIds.length; i += 90) {
    await getDb()
      .update(jobs)
      .set({ readAt: new Date(), updatedAt: new Date() })
      .where(inArray(jobs.id, jobIds.slice(i, i + 90)));
  }
  revalidateAll();
}
