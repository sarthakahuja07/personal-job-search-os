"use server";

import { revalidatePath } from "next/cache";

import { getDb } from "@/db";
import { companies } from "@/db/schema";
import * as repo from "@/server/repository/linkedin-repo";
import { ingestJobs } from "@/server/service/ingest";

export async function dismissLead(id: string) {
  await repo.dismissLead(getDb(), id);
  revalidatePath("/linkedin");
}

export async function restoreLead(id: string) {
  await repo.restoreLead(getDb(), id);
  revalidatePath("/linkedin");
}

/**
 * Take an employer off the leads list and onto the board.
 *
 * The company is created as a manual, tier-6 source: nothing here knows how to crawl it, and
 * pretending otherwise would put a permanently unhealthy row on the Companies page. Sarthak can
 * point it at a real careers URL afterwards if it is worth automating.
 *
 * Its parked postings are then pushed through the ordinary ingest path rather than copied into
 * `jobs` directly, so they are scored, deduplicated and notified about by the same code as
 * everything else. Only then are the leads deleted -- if ingest fails they stay parked, because
 * a lead that vanished without becoming a job is a job silently lost.
 */
export async function promoteLead(companyName: string) {
  const db = getDb();
  const leads = await repo.leadsForCompanyName(db, companyName);
  if (leads.length === 0) return { ok: false as const, reason: "no_leads" };

  const [company] = await db
    .insert(companies)
    .values({
      name: companyName,
      sourceType: "manual",
      sourceTier: 6,
      sourceConfig: {},
      active: true,
      // A manual company legitimately reports nothing, and marking it suspicious every crawl
      // would train the health signal to be ignored.
      allowZeroResults: true,
    })
    .returning({ id: companies.id });

  if (!company) return { ok: false as const, reason: "create_failed" };

  await ingestJobs(db, {
    run_id: `promote:${company.id}`,
    company_id: company.id,
    status: "success",
    tier: 6,
    seen_external_ids: [],
    jobs: leads.map((l) => ({
      external_job_id: l.linkedinJobId,
      title: l.title,
      job_url: l.jobUrl,
      location: l.location,
      description: null,
      posted_at: null,
      raw_metadata: { source: "linkedin_email", feed: l.feed, promoted_from_lead: true },
    })),
    // Never a measurement of what this company has open, so presence tracking must not run.
    is_final: false,
  });

  await repo.deleteLeadsForCompanyName(db, companyName);

  revalidatePath("/linkedin");
  revalidatePath("/jobs");
  revalidatePath("/companies");
  return { ok: true as const, companyId: company.id, jobs: leads.length };
}
