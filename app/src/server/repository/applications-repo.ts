/**
 * Application pipeline data access.
 *
 * The board is a few dozen cards, so it loads in one joined query rather than one per column.
 * D1 bills queries per invocation, and five column queries would be four more than necessary.
 */

import { and, asc, desc, eq } from "drizzle-orm";

import type { Db } from "@/db";
import { applications, companies, contacts, jobs, type ApplicationStatus } from "@/db/schema";
import { transition, type ApplicationTimestamps } from "../domain/applications";

export type BoardCard = {
  id: string;
  status: ApplicationStatus;
  notes: string | null;
  requestedAt: Date | null;
  referredAt: Date | null;
  appliedAt: Date | null;
  interviewStartedAt: Date | null;
  jobId: string;
  jobTitle: string;
  jobUrl: string;
  jobLocation: string | null;
  companyId: string;
  companyName: string;
};

export async function listBoard(db: Db): Promise<BoardCard[]> {
  return db
    .select({
      id: applications.id,
      status: applications.status,
      notes: applications.notes,
      requestedAt: applications.requestedAt,
      referredAt: applications.referredAt,
      appliedAt: applications.appliedAt,
      interviewStartedAt: applications.interviewStartedAt,
      jobId: jobs.id,
      jobTitle: jobs.title,
      jobUrl: jobs.jobUrl,
      jobLocation: jobs.location,
      companyId: companies.id,
      companyName: companies.name,
    })
    .from(applications)
    .innerJoin(jobs, eq(applications.jobId, jobs.id))
    .innerJoin(companies, eq(applications.companyId, companies.id))
    .orderBy(desc(applications.updatedAt));
}

export async function getByJobId(db: Db, jobId: string) {
  const rows = await db
    .select()
    .from(applications)
    .where(eq(applications.jobId, jobId))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Move a job to a stage, creating the application if this is the first time.
 *
 * Idempotent by shape: a job has at most one application (enforced by a unique index), so
 * clicking "Save" twice cannot produce two cards.
 */
export async function setStage(
  db: Db,
  jobId: string,
  companyId: string,
  next: ApplicationStatus,
  now: Date = new Date(),
): Promise<void> {
  const existing = await getByJobId(db, jobId);

  if (!existing) {
    const patch = transition({}, next, now);
    await db.insert(applications).values({
      id: crypto.randomUUID(),
      jobId,
      companyId,
      ...patch,
    });
    return;
  }

  const current: ApplicationTimestamps = {
    requestedAt: existing.requestedAt,
    referredAt: existing.referredAt,
    appliedAt: existing.appliedAt,
    interviewStartedAt: existing.interviewStartedAt,
  };
  await db
    .update(applications)
    .set({ ...transition(current, next, now), updatedAt: now })
    .where(eq(applications.id, existing.id));
}

export async function updateNotes(db: Db, id: string, notes: string | null): Promise<void> {
  await db
    .update(applications)
    .set({ notes, updatedAt: new Date() })
    .where(eq(applications.id, id));
}

export async function remove(db: Db, id: string): Promise<void> {
  await db.delete(applications).where(eq(applications.id, id));
}

/**
 * Cards in `requested`, with the contacts who could be chased. Loaded together because the
 * dashboard reminder is useless without a name and number to act on.
 */
export async function requestedWithContacts(db: Db) {
  const rows = await db
    .select({
      id: applications.id,
      status: applications.status,
      requestedAt: applications.requestedAt,
      jobTitle: jobs.title,
      jobUrl: jobs.jobUrl,
      companyId: companies.id,
      companyName: companies.name,
      contactName: contacts.name,
      contactPhone: contacts.phone,
      contactEmail: contacts.email,
    })
    .from(applications)
    .innerJoin(jobs, eq(applications.jobId, jobs.id))
    .innerJoin(companies, eq(applications.companyId, companies.id))
    .leftJoin(contacts, eq(contacts.companyId, companies.id))
    .where(eq(applications.status, "requested"))
    .orderBy(asc(applications.requestedAt));

  // The left join fans out one row per contact; collapse to one card carrying its contacts.
  const byId = new Map<string, {
    id: string;
    status: ApplicationStatus;
    requestedAt: Date | null;
    jobTitle: string;
    jobUrl: string;
    companyId: string;
    companyName: string;
    contacts: { name: string; phone: string | null; email: string | null }[];
  }>();

  for (const r of rows) {
    let card = byId.get(r.id);
    if (!card) {
      card = {
        id: r.id,
        status: r.status,
        requestedAt: r.requestedAt,
        jobTitle: r.jobTitle,
        jobUrl: r.jobUrl,
        companyId: r.companyId,
        companyName: r.companyName,
        contacts: [],
      };
      byId.set(r.id, card);
    }
    if (r.contactName) {
      card.contacts.push({
        name: r.contactName,
        phone: r.contactPhone,
        email: r.contactEmail,
      });
    }
  }
  return [...byId.values()];
}

/** Every job that already has an application, so the job board can show its stage. */
export async function stagesByJobId(db: Db): Promise<Map<string, ApplicationStatus>> {
  const rows = await db
    .select({ jobId: applications.jobId, status: applications.status })
    .from(applications);
  return new Map(rows.map((r) => [r.jobId, r.status]));
}

export async function countAll(db: Db): Promise<number> {
  const rows = await db.select({ status: applications.status }).from(applications);
  return rows.length;
}

export async function findForJobAndCompany(db: Db, jobId: string, companyId: string) {
  const rows = await db
    .select()
    .from(applications)
    .where(and(eq(applications.jobId, jobId), eq(applications.companyId, companyId)))
    .limit(1);
  return rows[0] ?? null;
}
