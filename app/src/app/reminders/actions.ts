"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { getDb } from "@/db";
import { reminderDismissals } from "@/db/schema";
import type { ReminderKind } from "@/server/domain/reminders";

/**
 * Close a reminder.
 *
 * Deliberately "not now" rather than "never": the dismissal is stamped with the current time and
 * the rules compare it against the moment the reminder's clock started, so a job that later
 * moves stage raises it again. Anything stronger would let one click permanently hide a
 * situation that has since changed — which is the failure this whole list exists to prevent.
 */
export async function dismissReminder(jobId: string, kind: string) {
  const db = getDb();
  const now = new Date();

  await db
    .insert(reminderDismissals)
    .values({ id: crypto.randomUUID(), jobId, kind: kind as ReminderKind, dismissedAt: now })
    .onConflictDoUpdate({
      target: [reminderDismissals.jobId, reminderDismissals.kind],
      set: { dismissedAt: now },
    });

  revalidatePath("/reminders");
  revalidatePath("/");
}

/** Bring a closed reminder back, for when it was closed by mistake. */
export async function restoreReminder(jobId: string, kind: string) {
  await getDb()
    .delete(reminderDismissals)
    .where(
      and(
        eq(reminderDismissals.jobId, jobId),
        eq(reminderDismissals.kind, kind as ReminderKind),
      ),
    );
  revalidatePath("/reminders");
  revalidatePath("/");
}
