/**
 * Data access for the LinkedIn email source.
 *
 * Same two D1 limits as ingest-repo -- 100 bound parameters per query, 50 queries per Worker
 * invocation -- so writes are chunked multi-row statements sized by column count, and merges
 * are budgeted rather than looped without limit. The crawler chunks its POSTs to match.
 */

import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";

import type { Db } from "@/db";
import {
  applications,
  companies,
  contacts,
  jobs,
  linkedinLeads,
  type LinkedinFeed,
} from "@/db/schema";
import type { CompanyMatchOverrides } from "@/server/domain/matching";

const MAX_BOUND_PARAMS = 100;

/** linkedin_leads binds 8 columns per row. */
export const LEAD_COLUMNS = 8;
export const LEAD_CHUNK = Math.floor(MAX_BOUND_PARAMS / LEAD_COLUMNS); // 12

/**
 * Merges are single-row UPDATEs and cannot be batched into one statement, so they are the one
 * thing here that scales with input. The crawler keeps a request under this many postings, and
 * the service refuses to exceed it rather than half-applying a batch.
 */
export const MAX_MERGES_PER_REQUEST = 30;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Every company, with the alternate spellings an alert might use. */
export async function loadCompaniesForLinkedIn(db: Db) {
  const rows = await db
    .select({
      id: companies.id,
      name: companies.name,
      active: companies.active,
      overrides: companies.matchOverrides,
    })
    .from(companies);

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    active: r.active,
    aliases: (r.overrides as CompanyMatchOverrides | null)?.aliases ?? undefined,
  }));
}

/**
 * Open jobs, in the shape the resolver compares against.
 *
 * Deliberately every open job rather than a filtered subset: the resolver decides what matches,
 * and pre-filtering here by title would move that decision into SQL where it cannot be tested.
 */
export async function loadOpenJobsForLinkedIn(db: Db) {
  return db
    .select({
      id: jobs.id,
      companyId: jobs.companyId,
      title: jobs.title,
      location: jobs.location,
      postedAt: jobs.postedAt,
      linkedinJobId: jobs.linkedinJobId,
    })
    .from(jobs)
    .where(isNull(jobs.closedAt));
}

/** Record that an opening already on the board is also on LinkedIn. */
export async function applyLinkedInMerges(
  db: Db,
  merges: { jobId: string; linkedinJobId: string; linkedinUrl: string }[],
): Promise<number> {
  let applied = 0;
  for (const m of merges.slice(0, MAX_MERGES_PER_REQUEST)) {
    await db
      .update(jobs)
      .set({ linkedinJobId: m.linkedinJobId, linkedinUrl: m.linkedinUrl })
      .where(eq(jobs.id, m.jobId));
    applied += 1;
  }
  return applied;
}

export type NewLead = {
  linkedinJobId: string;
  companyName: string;
  title: string;
  location: string | null;
  jobUrl: string;
  feed: LinkedinFeed;
  postedAt: Date | null;
};

/**
 * Park postings from companies that are not on the board.
 *
 * `onConflictDoNothing` on the posting id is what makes re-reading the same mailbox harmless:
 * a lead Sarthak already dismissed must not come back because the alert did.
 */
export async function upsertLeads(db: Db, leads: NewLead[]): Promise<number> {
  if (leads.length === 0) return 0;
  let written = 0;
  for (const group of chunk(leads, LEAD_CHUNK)) {
    const res = await db
      .insert(linkedinLeads)
      .values(
        group.map((l) => ({
          linkedinJobId: l.linkedinJobId,
          companyName: l.companyName,
          title: l.title,
          location: l.location,
          jobUrl: l.jobUrl,
          feed: l.feed,
          postedAt: l.postedAt,
        })),
      )
      .onConflictDoNothing({ target: linkedinLeads.linkedinJobId })
      .returning({ id: linkedinLeads.id });
    written += res.length;
  }
  return written;
}

/** Leads still waiting on a decision, newest first, grouped in the UI by company. */
export async function listLeads(db: Db, limit = 200) {
  return db
    .select({
      id: linkedinLeads.id,
      linkedinJobId: linkedinLeads.linkedinJobId,
      companyName: linkedinLeads.companyName,
      title: linkedinLeads.title,
      location: linkedinLeads.location,
      jobUrl: linkedinLeads.jobUrl,
      feed: linkedinLeads.feed,
      postedAt: linkedinLeads.postedAt,
      discoveredAt: linkedinLeads.discoveredAt,
    })
    .from(linkedinLeads)
    .where(isNull(linkedinLeads.dismissedAt))
    .orderBy(desc(linkedinLeads.discoveredAt))
    .limit(limit);
}

export async function dismissLead(db: Db, id: string) {
  await db
    .update(linkedinLeads)
    .set({ dismissedAt: new Date() })
    .where(eq(linkedinLeads.id, id));
}

export async function restoreLead(db: Db, id: string) {
  await db.update(linkedinLeads).set({ dismissedAt: null }).where(eq(linkedinLeads.id, id));
}

/** Leads for one employer, for the "add this company" flow. */
export async function leadsForCompanyName(db: Db, companyName: string) {
  return db
    .select()
    .from(linkedinLeads)
    .where(and(eq(linkedinLeads.companyName, companyName), isNull(linkedinLeads.dismissedAt)));
}

export async function deleteLeadsForCompanyName(db: Db, companyName: string) {
  await db.delete(linkedinLeads).where(eq(linkedinLeads.companyName, companyName));
}

/**
 * Jobs that came from LinkedIn, or that LinkedIn also carries.
 *
 * One query feeds the whole page: `source` tells the two apart, so a job discovered through a
 * company's ATS and later seen on LinkedIn is shown as the ATS job it is, with a LinkedIn link,
 * rather than as a second card.
 */
export async function listLinkedInJobs(db: Db, limit = 300) {
  return db
    .select({
      id: jobs.id,
      title: jobs.title,
      location: jobs.location,
      jobUrl: jobs.jobUrl,
      linkedinUrl: jobs.linkedinUrl,
      linkedinJobId: jobs.linkedinJobId,
      postedAt: jobs.postedAt,
      discoveredAt: jobs.discoveredAt,
      matchScore: jobs.matchScore,
      matchReason: jobs.matchReason,
      locationPriority: jobs.locationPriority,
      fitScore: jobs.fitScore,
      fitBand: jobs.fitBand,
      fitSignals: jobs.fitSignals,
      fitTitleOnly: jobs.fitTitleOnly,
      isRelevant: jobs.isRelevant,
      readAt: jobs.readAt,
      source: jobs.source,
      rawMetadata: jobs.rawMetadata,
      companyId: companies.id,
      companyName: companies.name,
      applicationStatus: applications.status,
    })
    .from(jobs)
    .innerJoin(companies, eq(jobs.companyId, companies.id))
    .leftJoin(applications, eq(applications.jobId, jobs.id))
    .where(
      and(
        isNull(jobs.closedAt),
        sql`(${jobs.source} = 'linkedin_email' OR ${jobs.linkedinJobId} IS NOT NULL)`,
      ),
    )
    .orderBy(desc(jobs.postedAt), desc(jobs.discoveredAt))
    .limit(limit);
}

/** Contact counts per company, for the card's Message button. One query, not one per card. */
export async function contactCounts(db: Db) {
  const rows = await db
    .select({ companyId: contacts.companyId, n: sql<number>`count(*)` })
    .from(contacts)
    .groupBy(contacts.companyId);
  return new Map(rows.map((r) => [r.companyId, r.n]));
}

/** Counts for the sidebar badge and the page header. */
export async function linkedinCounts(db: Db) {
  const [fromLinkedIn] = await db
    .select({ n: sql<number>`count(*)` })
    .from(jobs)
    .where(
      and(
        isNull(jobs.closedAt),
        isNull(jobs.readAt),
        eq(jobs.isRelevant, true),
        sql`(${jobs.source} = 'linkedin_email' OR ${jobs.linkedinJobId} IS NOT NULL)`,
      ),
    );

  const [leadCount] = await db
    .select({ n: sql<number>`count(*)` })
    .from(linkedinLeads)
    .where(isNull(linkedinLeads.dismissedAt));

  return { unreadJobs: fromLinkedIn?.n ?? 0, leads: leadCount?.n ?? 0 };
}

/** Referral contacts for the companies shown on the page, fetched in one query. */
export async function contactsForCompanies(db: Db, companyIds: string[]) {
  if (companyIds.length === 0) return [];
  const ids = companyIds.slice(0, 90);
  return db
    .select({
      companyId: contacts.companyId,
      id: contacts.id,
      name: contacts.name,
      phone: contacts.phone,
      email: contacts.email,
      linkedinUrl: contacts.linkedinUrl,
    })
    .from(contacts)
    .where(inArray(contacts.companyId, ids));
}

/** Jobs already carrying a LinkedIn id, for reporting how much of the board LinkedIn covers. */
export async function linkedinMergedCount(db: Db) {
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(jobs)
    .where(and(isNull(jobs.closedAt), isNotNull(jobs.linkedinJobId)));
  return row?.n ?? 0;
}
