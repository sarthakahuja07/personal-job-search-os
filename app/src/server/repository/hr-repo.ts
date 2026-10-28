/**
 * Reads and writes for the HR page.
 *
 * Two queries for the whole page — the HR contacts with their companies, and every relevant
 * open job at those companies — rather than one lookup per company. Which of those openings is
 * worth a call is decided in domain/hr.ts, not here.
 */

import { and, asc, eq, inArray, isNotNull, isNull, or } from "drizzle-orm";

import type { Db } from "@/db";
import { applications, companies, contacts, jobs } from "@/db/schema";
import type { HrCompany, HrOpening } from "@/server/domain/hr";

/** Companies with at least one HR contact, each carrying its contacts. */
export async function listHrCompanies(db: Db): Promise<HrCompany[]> {
  const rows = await db
    .select({
      companyId: companies.id,
      companyName: companies.name,
      careersUrl: companies.careersUrl,
      sourceType: companies.sourceType,
      active: companies.active,
      healthStatus: companies.healthStatus,
      id: contacts.id,
      name: contacts.name,
      phone: contacts.phone,
      email: contacts.email,
      linkedinUrl: contacts.linkedinUrl,
      notes: contacts.notes,
      lastCalledAt: contacts.lastCalledAt,
    })
    .from(contacts)
    .innerJoin(companies, eq(contacts.companyId, companies.id))
    .where(eq(contacts.role, "hr"))
    .orderBy(asc(companies.name), asc(contacts.name));

  const byId = new Map<string, HrCompany>();
  for (const r of rows) {
    let c = byId.get(r.companyId);
    if (!c) {
      c = {
        id: r.companyId,
        name: r.companyName,
        careersUrl: r.careersUrl,
        sourceType: r.sourceType,
        active: r.active,
        healthStatus: r.healthStatus,
        contacts: [],
      };
      byId.set(r.companyId, c);
    }
    c.contacts.push({
      id: r.id,
      name: r.name,
      phone: r.phone,
      email: r.email,
      linkedinUrl: r.linkedinUrl,
      notes: r.notes,
      lastCalledAt: r.lastCalledAt,
    });
  }
  return [...byId.values()];
}

/**
 * Relevant open jobs at the given companies, minus the ones passed over.
 *
 * A read job that never entered the pipeline was a decision not to pursue it, and a phone call
 * is pursuing it. But tracking a job marks it read too, and a tracked job is exactly what a
 * recruiter can move, so pipeline jobs stay whatever their read state.
 */
export async function listHrOpenings(db: Db, companyIds: string[]): Promise<HrOpening[]> {
  if (companyIds.length === 0) return [];
  const rows = await db
    .select({
      jobId: jobs.id,
      companyId: jobs.companyId,
      title: jobs.title,
      location: jobs.location,
      jobUrl: jobs.jobUrl,
      discoveredAt: jobs.discoveredAt,
      fitScore: jobs.fitScore,
      fitBand: jobs.fitBand,
      status: applications.status,
    })
    .from(jobs)
    .leftJoin(applications, eq(applications.jobId, jobs.id))
    .where(
      and(
        // D1 caps bound parameters at 100; there are far fewer HR companies than that.
        inArray(jobs.companyId, companyIds.slice(0, 90)),
        eq(jobs.isRelevant, true),
        isNull(jobs.closedAt),
        or(isNull(jobs.readAt), isNotNull(applications.status)),
      ),
    );
  return rows.map((r) => ({ ...r, status: r.status ?? null }));
}

/** HR contacts per company name, for the digest email: name and number, nothing else. */
export async function hrContactsByCompanyName(db: Db) {
  const rows = await db
    .select({ company: companies.name, name: contacts.name, phone: contacts.phone })
    .from(contacts)
    .innerJoin(companies, eq(contacts.companyId, companies.id))
    .where(eq(contacts.role, "hr"))
    .orderBy(asc(contacts.name));
  const out = new Map<string, { name: string; phone: string | null }[]>();
  for (const r of rows) {
    const list = out.get(r.company);
    if (list) list.push({ name: r.name, phone: r.phone });
    else out.set(r.company, [{ name: r.name, phone: r.phone }]);
  }
  return out;
}

export async function setLastCalled(db: Db, contactId: string, at: Date | null) {
  await db
    .update(contacts)
    .set({ lastCalledAt: at, updatedAt: new Date() })
    .where(eq(contacts.id, contactId));
}
