/**
 * Outbox access.
 *
 * Ingest writes rows here and never sends. A GitHub Actions step drains them over SMTP and
 * confirms delivery. Splitting "decide" from "send" is what makes duplicate emails structurally
 * impossible: the UNIQUE dedup_key stops the row being created twice, and a crash between
 * sending and confirming can at worst re-send one digest, never a flood.
 *
 * See docs/decisions/007-ingest-boundary-and-notification-outbox.md.
 */

import { and, asc, eq, inArray, lt, sql, desc, isNull, or } from "drizzle-orm";

import type { Db } from "@/db";
import { companies, jobs, notifications, settings, emailDigests } from "@/db/schema";

/** Give up after this many delivery attempts so a poison row cannot block the queue forever. */
export const MAX_ATTEMPTS = 5;

export type PendingNotification = {
  id: string;
  dedupKey: string;
  notificationType: string;
  attempts: number;
  jobId: string | null;
  title: string | null;
  companyName: string | null;
  location: string | null;
  jobUrl: string | null;
  matchScore: number | null;
  matchReason: string | null;
};

export async function listPending(db: Db, limit = 100): Promise<PendingNotification[]> {
  return db
    .select({
      id: notifications.id,
      dedupKey: notifications.dedupKey,
      notificationType: notifications.notificationType,
      attempts: notifications.attempts,
      jobId: notifications.entityId,
      title: jobs.title,
      companyName: companies.name,
      location: jobs.location,
      jobUrl: jobs.jobUrl,
      matchScore: jobs.matchScore,
      matchReason: jobs.matchReason,
    })
    .from(notifications)
    // Left joins: a notification must remain drainable even if its job row is gone.
    .leftJoin(jobs, eq(jobs.id, notifications.entityId))
    .leftJoin(companies, eq(companies.id, jobs.companyId))
    .where(
      and(
        eq(notifications.status, "pending"),
        lt(notifications.attempts, MAX_ATTEMPTS),
        // Re-check relevance at send time, not only at queue time. Match rules are data and can
        // change in between -- a Canadian role queued before the location list learned about
        // "CA Remote Ontario" was still sitting here, ready to be emailed with a score of 0 and
        // its own rejection printed underneath it. The job row being absent still drains, so a
        // deleted job cannot wedge the queue.
        or(
          isNull(jobs.id),
          and(eq(jobs.isRelevant, true), isNull(jobs.closedAt)),
        ),
      ),
    )
    .orderBy(asc(notifications.createdAt))
    .limit(limit);
}

/** D1 allows 100 bound parameters per query. */
const ID_CHUNK = 90;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export async function markSent(db: Db, ids: string[]): Promise<void> {
  for (const group of chunk(ids, ID_CHUNK)) {
    await db
      .update(notifications)
      .set({
        status: "sent",
        sentAt: new Date(),
        error: null,
        attempts: sql`${notifications.attempts} + 1`,
      })
      .where(inArray(notifications.id, group));
  }
}

/**
 * Record a failure without discarding the row. It stays pending and is retried on the next run
 * until MAX_ATTEMPTS, after which it is left visible rather than deleted -- a notification that
 * could never be delivered is worth seeing.
 */
export async function markFailed(db: Db, ids: string[], error: string): Promise<void> {
  for (const group of chunk(ids, ID_CHUNK)) {
    await db
      .update(notifications)
      .set({
        error: error.slice(0, 500),
        attempts: sql`${notifications.attempts} + 1`,
        status: sql`CASE WHEN ${notifications.attempts} + 1 >= ${MAX_ATTEMPTS} THEN 'failed' ELSE 'pending' END`,
      })
      .where(inArray(notifications.id, group));
  }
}

export async function notifyEmail(db: Db): Promise<string | null> {
  const rows = await db
    .select({ notifyEmail: settings.notifyEmail })
    .from(settings)
    .limit(1);
  return rows[0]?.notifyEmail ?? null;
}

export async function listRecent(db: Db, limit = 50) {
  return db
    .select({
      id: notifications.id,
      dedupKey: notifications.dedupKey,
      notificationType: notifications.notificationType,
      status: notifications.status,
      attempts: notifications.attempts,
      sentAt: notifications.sentAt,
      createdAt: notifications.createdAt,
      error: notifications.error,
      title: jobs.title,
      companyName: companies.name,
      jobUrl: jobs.jobUrl,
    })
    .from(notifications)
    .leftJoin(jobs, eq(jobs.id, notifications.entityId))
    .leftJoin(companies, eq(companies.id, jobs.companyId))
    .orderBy(sql`${notifications.createdAt} DESC`)
    .limit(limit);
}

/**
 * The digest emails actually sent, newest first.
 *
 * One row per email rather than per notification: a digest covering sixteen jobs is one thing
 * that arrived in the inbox, and that is the unit worth reviewing.
 */
export async function listDigests(db: Db, limit = 60) {
  return db
    .select({
      id: emailDigests.id,
      subject: emailDigests.subject,
      bodyText: emailDigests.bodyText,
      recipient: emailDigests.recipient,
      notificationCount: emailDigests.notificationCount,
      sentAt: emailDigests.sentAt,
    })
    .from(emailDigests)
    .orderBy(desc(emailDigests.sentAt))
    .limit(limit);
}
