import type { Db } from "@/db";
import {
  resolveLinkedInPostings,
  type LinkedInPosting,
} from "@/server/domain/linkedin";
import * as repo from "@/server/repository/linkedin-repo";
import type { LinkedInIngestPayload } from "@/server/schemas/linkedin";
import type { IngestJob } from "@/server/schemas/ingest";

/**
 * Turning a mailbox into board entries.
 *
 * This service resolves and then applies only the two outcomes it can apply cheaply -- merges
 * and leads. Inserts are handed back to the crawler to POST through `/api/ingest/jobs`, one
 * request per company.
 *
 * That looks like a detour and is deliberate. Inserting here would mean reimplementing
 * relevance matching, new-job detection and notification queueing, which are the most heavily
 * tested code in the project and already run per company. Routing inserts through the existing
 * path means a LinkedIn job is scored, deduplicated and notified about by exactly the same code
 * as an ATS job, and it keeps each Worker invocation inside D1's 50-query budget instead of
 * doing every company's work in one request.
 */

export type LinkedInIngestResult = {
  received: number;
  merged: number;
  leads: number;
  /** Ingest payload fragments, one per company, for the crawler to post onward. */
  inserts: { company_id: string; company_name: string; jobs: IngestJob[] }[];
  /** Companies matched by name but switched off; their postings are dropped, not parked. */
  skippedInactive: string[];
};

function toIngestJob(posting: LinkedInPosting): IngestJob {
  return {
    external_job_id: posting.linkedinJobId,
    title: posting.title,
    job_url: posting.jobUrl,
    location: posting.location,
    // LinkedIn alert mail carries no description and no reliable posting date -- only relative
    // phrases like "2 days ago", which ADR 005 forbids storing as a date. Null is the honest
    // answer; the matcher already knows to score on title alone and to say so.
    description: null,
    posted_at: null,
    raw_metadata: {
      source: "linkedin_email",
      feed: posting.feed,
      linkedin_job_id: posting.linkedinJobId,
      ...(posting.searchTerm ? { search_term: posting.searchTerm } : {}),
      ...(posting.workMode ? { work_mode: posting.workMode } : {}),
    },
  };
}

export async function ingestLinkedInPostings(
  db: Db,
  payload: LinkedInIngestPayload,
): Promise<LinkedInIngestResult> {
  const postings: LinkedInPosting[] = payload.postings.map((p) => ({
    linkedinJobId: p.linkedin_job_id,
    companyName: p.company_name,
    title: p.title,
    location: p.location ?? null,
    workMode: p.work_mode === "onsite" ? "on-site" : (p.work_mode ?? null),
    jobUrl: p.job_url,
    postedAt: null,
    feed: p.feed,
    searchTerm: p.search_term ?? null,
  }));

  const [allCompanies, existingJobs] = await Promise.all([
    repo.loadCompaniesForLinkedIn(db),
    repo.loadOpenJobsForLinkedIn(db),
  ]);

  const resolution = resolveLinkedInPostings({
    postings,
    companies: allCompanies,
    existingJobs,
  });

  const merged = await repo.applyLinkedInMerges(db, resolution.merges);

  const leads = await repo.upsertLeads(
    db,
    resolution.leads.map((l) => ({
      linkedinJobId: l.linkedinJobId,
      companyName: l.companyName,
      title: l.title,
      location: l.location,
      jobUrl: l.jobUrl,
      feed: l.feed,
      postedAt: null,
    })),
  );

  // An inactive company is one Sarthak switched off on purpose. Ingest rejects writes to it,
  // and parking its postings as leads would propose a company he already has and declined.
  const byId = new Map(allCompanies.map((c) => [c.id, c]));
  const grouped = new Map<string, LinkedInPosting[]>();
  const skippedInactive = new Set<string>();

  for (const { companyId, posting } of resolution.inserts) {
    const company = byId.get(companyId);
    if (!company?.active) {
      if (company) skippedInactive.add(company.name);
      continue;
    }
    grouped.set(companyId, [...(grouped.get(companyId) ?? []), posting]);
  }

  return {
    received: postings.length,
    merged,
    leads,
    inserts: [...grouped].map(([companyId, ps]) => ({
      company_id: companyId,
      company_name: byId.get(companyId)?.name ?? "",
      jobs: ps.map(toIngestJob),
    })),
    skippedInactive: [...skippedInactive],
  };
}
