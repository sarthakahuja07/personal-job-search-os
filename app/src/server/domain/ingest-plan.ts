/**
 * Ingest decision logic -- pure, so it can be tested exhaustively without a database.
 *
 * The service layer loads state, calls this, and writes the result. Everything that decides
 * *what should happen* lives here; everything that decides *how to persist it* lives in the
 * repository. That split is what makes the idempotency and zero-result guarantees testable.
 *
 * See docs/decisions/008-crawler-correctness-strategy.md.
 */

import { scoreFit, type FitBand, type FitSignal } from "./fit";
import { matchJob, type MatchRules } from "./matching";

export type ExistingJob = {
  id: string;
  externalJobId: string;
  isRelevant: boolean;
  missingRunCount: number;
  closedAt: Date | null;
};

export type IncomingJob = {
  externalJobId: string;
  title: string;
  jobUrl: string;
  normalizedJobUrl: string;
  location?: string | null;
  department?: string | null;
  description?: string | null;
  employmentType?: string | null;
  postedAt?: Date | null;
  rawMetadata?: Record<string, unknown>;
};

export type CrawlStatus =
  | "success"
  | "failed"
  | "suspicious"
  | "degraded"
  | "skipped";

export type PlanInput = {
  reportedStatus: CrawlStatus;
  /** Every requisition id the crawler saw, including ones it filtered out. */
  seenExternalIds: string[];
  /** Full records, only for postings that passed the crawler's title pre-filter. */
  jobs: IncomingJob[];
  existing: ExistingJob[];
  rules: MatchRules;
  /** Company opted in to legitimately-empty boards. */
  allowZeroResults: boolean;
  /** Whether this company has ever returned jobs before. */
  hasSeenJobsBefore: boolean;
  /** Consecutive successful runs a job must be absent from before it is closed. */
  closeAfterMissingRuns: number;
  /** Median job count of recent successful runs, for drift detection. Null if unknown. */
  recentMedianCount: number | null;
  /**
   * False for a non-final chunk. Presence tracking runs exactly once per crawl, against the
   * complete observed id set; on a partial chunk it would close jobs that are perfectly alive.
   */
  isFinal: boolean;
};

export type PlannedJob = IncomingJob & {
  isRelevant: boolean;
  matchScore: number;
  matchReason: string;
  locationPriority: number | null;
  /** Fit against Sarthak's resume, 0-100. See domain/fit.ts. */
  fitScore: number;
  fitBand: FitBand;
  fitSignals: FitSignal[];
  fitTitleOnly: boolean;
  /** Present when this job already exists. */
  existingId: string | null;
};

export type PlannedNotification = {
  dedupKey: string;
  notificationType: "new_job";
  externalJobId: string;
  title: string;
  matchReason: string;
};

export type IngestPlan = {
  /** Final status recorded for the run -- may be stricter than what the crawler reported. */
  status: CrawlStatus;
  statusReason: string | null;
  upserts: PlannedJob[];
  /** External ids that did not previously exist. */
  createdExternalIds: string[];
  notifications: PlannedNotification[];
  /** Existing job ids absent from this crawl; missing_run_count should increment. */
  missingJobIds: string[];
  /** Existing job ids that have now been absent long enough to close. */
  closeJobIds: string[];
  /**
   * Jobs that were previously missing but reappeared. Their counter must reset, otherwise a
   * job that flickers in and out of a flaky feed would eventually be closed while still live.
   */
  resetMissingJobIds: string[];
  /** True when the run must not mutate job presence state. */
  presenceTrackingSkipped: boolean;
};

const DRIFT_DROP_RATIO = 0.5;

export function planIngest(input: PlanInput): IngestPlan {
  const {
    reportedStatus,
    seenExternalIds,
    jobs,
    existing,
    rules,
    allowZeroResults,
    hasSeenJobsBefore,
    closeAfterMissingRuns,
    recentMedianCount,
    isFinal,
  } = input;

  const empty: IngestPlan = {
    status: reportedStatus,
    statusReason: null,
    upserts: [],
    createdExternalIds: [],
    notifications: [],
    missingJobIds: [],
    closeJobIds: [],
    resetMissingJobIds: [],
    presenceTrackingSkipped: true,
  };

  // A run that did not succeed must never touch presence state. Without this, one broken
  // adapter would mark every job at that company as missing and eventually close them all.
  if (reportedStatus !== "success") {
    return { ...empty, statusReason: `crawler reported ${reportedStatus}` };
  }

  // Zero results is an error by default: it is indistinguishable from a silently broken adapter.
  //
  // Only the final chunk can say this, though. When a company's jobs are split across requests
  // every earlier chunk carries an empty `seen_external_ids` by design -- the complete observed
  // set rides on the last one. Judging a non-final chunk by it returned the empty plan, so that
  // chunk's jobs were silently dropped: at Amazon, the largest source of relevant results here,
  // a genuinely new job stayed invisible until it happened to fall in the final chunk.
  if (isFinal && seenExternalIds.length === 0 && !allowZeroResults && hasSeenJobsBefore) {
    return {
      ...empty,
      status: "suspicious",
      statusReason:
        "returned zero jobs but has returned jobs before, and allow_zero_results is not set",
    };
  }

  // Volume drift: a large drop against recent history is suspicious even when non-zero.
  // Same reasoning as above -- a partial chunk is not a measurement of the board's size.
  let status: CrawlStatus = "success";
  let statusReason: string | null = null;
  if (
    isFinal &&
    recentMedianCount !== null &&
    recentMedianCount > 0 &&
    seenExternalIds.length < recentMedianCount * DRIFT_DROP_RATIO
  ) {
    status = "degraded";
    statusReason = `job count ${seenExternalIds.length} is below half the recent median ${recentMedianCount}`;
  }

  const existingByExternalId = new Map(existing.map((e) => [e.externalJobId, e]));

  const upserts: PlannedJob[] = [];
  const createdExternalIds: string[] = [];
  const notifications: PlannedNotification[] = [];

  for (const job of jobs) {
    const match = matchJob(
      { title: job.title, location: job.location, description: job.description },
      rules,
    );
    const prior = existingByExternalId.get(job.externalJobId) ?? null;

    // Fit is computed for every job, relevant or not: a job that fails the gate today may pass
    // it after a rules change, and re-scoring on read would make the board's ordering depend on
    // when it was loaded.
    const fit = scoreFit({
      title: job.title,
      description: job.description,
      locationPriority: match.locationPriority,
      postedAt: job.postedAt,
    });

    upserts.push({
      ...job,
      fitScore: fit.score,
      fitBand: fit.band,
      fitSignals: fit.signals,
      fitTitleOnly: fit.titleOnly,
      isRelevant: match.isRelevant,
      matchScore: match.score,
      matchReason: match.reason,
      locationPriority: match.locationPriority,
      existingId: prior?.id ?? null,
    });

    if (!prior) {
      createdExternalIds.push(job.externalJobId);
      // Only genuinely new AND relevant jobs are worth an email.
      if (match.isRelevant) {
        notifications.push({
          dedupKey: `new_job:${job.externalJobId}`,
          notificationType: "new_job",
          externalJobId: job.externalJobId,
          title: job.title,
          matchReason: match.reason,
        });
      }
    }
  }

  // Presence tracking uses the full observed id set, not just the filtered records -- and
  // only on the final chunk, when that set is complete.
  if (!isFinal) {
    return {
      status,
      statusReason,
      upserts,
      createdExternalIds,
      notifications,
      missingJobIds: [],
      closeJobIds: [],
      resetMissingJobIds: [],
      presenceTrackingSkipped: true,
    };
  }

  const seen = new Set(seenExternalIds);
  const missingJobIds: string[] = [];
  const closeJobIds: string[] = [];
  const resetMissingJobIds: string[] = [];
  for (const e of existing) {
    if (e.closedAt) continue;
    if (seen.has(e.externalJobId)) {
      if (e.missingRunCount > 0) resetMissingJobIds.push(e.id);
      continue;
    }
    missingJobIds.push(e.id);
    if (e.missingRunCount + 1 >= closeAfterMissingRuns) closeJobIds.push(e.id);
  }

  return {
    status,
    statusReason,
    upserts,
    createdExternalIds,
    notifications,
    missingJobIds,
    closeJobIds,
    resetMissingJobIds,
    presenceTrackingSkipped: false,
  };
}
