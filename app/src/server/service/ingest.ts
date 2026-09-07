/**
 * Ingest orchestration: load state, ask the planner what should happen, persist the result.
 *
 * No business rules live here -- they are all in domain/ingest-plan.ts and domain/matching.ts,
 * which are pure and exhaustively tested. This layer is deliberately mechanical.
 */

import type { Db } from "@/db";
import type { HealthStatus } from "@/db/schema";
import { normalizeJobUrl } from "../domain/url";
import {
  planIngest,
  type CrawlStatus,
  type IncomingJob,
} from "../domain/ingest-plan";
import * as repo from "../repository/ingest-repo";
import type { IngestPayload } from "../schemas/ingest";

export type IngestResult = {
  runId: string;
  companyId: string;
  received: number;
  observed: number;
  created: number;
  updated: number;
  relevantNew: number;
  notificationsQueued: number;
  statusRecorded: CrawlStatus;
  statusReason: string | null;
  jobsClosed: number;
  jobsMarkedMissing: number;
};

export class CompanyNotFoundError extends Error {}
export class CompanyInactiveError extends Error {}

const HEALTH_BY_STATUS: Record<CrawlStatus, HealthStatus> = {
  success: "healthy",
  degraded: "degraded",
  suspicious: "suspicious",
  failed: "failing",
  skipped: "healthy",
};

function toIncoming(payload: IngestPayload): IncomingJob[] {
  return payload.jobs.map((j) => ({
    externalJobId: j.external_job_id,
    title: j.title,
    jobUrl: j.job_url,
    normalizedJobUrl: normalizeJobUrl(j.job_url),
    location: j.location ?? null,
    department: j.department ?? null,
    description: j.description ?? null,
    employmentType: j.employment_type ?? null,
    // Parsed as UTC midnight; the crawler guarantees an ISO date or null, never display text.
    postedAt: j.posted_at ? new Date(`${j.posted_at}T00:00:00Z`) : null,
    rawMetadata: j.raw_metadata,
  }));
}

export async function ingestJobs(
  db: Db,
  payload: IngestPayload,
  startedAt = new Date(),
): Promise<IngestResult> {
  const company = await repo.loadCompany(db, payload.company_id);
  if (!company) throw new CompanyNotFoundError(payload.company_id);
  if (!company.active) throw new CompanyInactiveError(company.name);

  const [{ rules, closeAfterMissingRuns }, existing] = await Promise.all([
    repo.loadSettings(db),
    repo.loadExistingJobs(db, company.id),
  ]);
  const recentMedianCount = await repo.recentMedianJobCount(db, company.id);

  const plan = planIngest({
    reportedStatus: payload.status,
    seenExternalIds: payload.seen_external_ids,
    jobs: toIncoming(payload),
    existing,
    rules,
    allowZeroResults: company.allowZeroResults,
    hasSeenJobsBefore: existing.length > 0,
    closeAfterMissingRuns,
    recentMedianCount,
    isFinal: payload.is_final,
  });

  let notificationsQueued = 0;

  if (plan.upserts.length > 0) {
    await repo.upsertJobs(db, company.id, company.sourceType, plan.upserts);
  }

  if (plan.notifications.length > 0) {
    // Resolve ids only for jobs we are actually notifying about -- typically a handful.
    const idMap = await repo.jobIdsByExternalId(
      db,
      company.id,
      plan.notifications.map((n) => n.externalJobId),
    );
    notificationsQueued = await repo.queueNotifications(
      db,
      company.id,
      plan.notifications,
      idMap,
    );
  }

  if (!plan.presenceTrackingSkipped) {
    if (plan.missingJobIds.length) await repo.incrementMissing(db, plan.missingJobIds);
    if (plan.resetMissingJobIds.length) await repo.resetMissing(db, plan.resetMissingJobIds);
    if (plan.closeJobIds.length) await repo.closeJobs(db, plan.closeJobIds);
  }

  // Only the final chunk describes the run. A non-final chunk deliberately carries an empty
  // seen_external_ids (the full observed set rides on the last one), so recording it would
  // write a zero-jobs row and flip the company to `suspicious` mid-crawl -- Amazon's 2,385 jobs
  // did exactly that on every single run. The danger is not the stray row, it is that routine
  // chunking then looks identical to a genuine empty board, which is the one alarm this
  // project cannot afford to have crying wolf.
  if (payload.is_final) {
    await repo.recordCrawlRun(db, {
      runId: payload.run_id,
      companyId: company.id,
      status: plan.status,
      tier: payload.tier ?? null,
      jobsFound: payload.seen_external_ids.length,
      newJobs: plan.createdExternalIds.length,
      durationMs: payload.duration_ms ?? null,
      skipReason: payload.skip_reason ?? null,
      error: payload.error ?? plan.statusReason ?? null,
      startedAt,
    });

    await repo.updateCompanyHealth(db, company.id, {
      healthStatus: HEALTH_BY_STATUS[plan.status],
      lastError: payload.error ?? plan.statusReason ?? null,
      succeeded: plan.status === "success",
      // Only persist cache keys from a run we trust; caching a broken run would make the next
      // one short-circuit on a 304 and hide the failure.
      ...(plan.status === "success"
        ? {
            etag: payload.etag ?? null,
            lastModified: payload.last_modified ?? null,
            lastContentHash: payload.content_hash ?? null,
          }
        : {}),
    });
  }

  return {
    runId: payload.run_id,
    companyId: company.id,
    received: payload.jobs.length,
    observed: payload.seen_external_ids.length,
    created: plan.createdExternalIds.length,
    updated: plan.upserts.length - plan.createdExternalIds.length,
    relevantNew: plan.notifications.length,
    notificationsQueued,
    statusRecorded: plan.status,
    statusReason: plan.statusReason,
    jobsClosed: plan.closeJobIds.length,
    jobsMarkedMissing: plan.missingJobIds.length,
  };
}
