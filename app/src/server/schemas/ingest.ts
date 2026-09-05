import { z } from "zod";

/**
 * The crawler -> app contract. See docs/api.md.
 *
 * Two lists, deliberately:
 *
 *   seenExternalIds   EVERY requisition id the crawler observed, even ones it filtered out.
 *                     Presence tracking needs the full set -- without it a job that merely failed
 *                     the title filter would look like it had vanished and eventually be closed.
 *
 *   jobs              Full records, but only for postings that passed the crawler's cheap
 *                     title-only pre-filter. NVIDIA lists 2000 roles and about 20 survive that
 *                     gate; sending all 2000 in full would be wasteful and, given D1's 100-bound-
 *                     parameter and 50-query-per-invocation limits, unworkable.
 */

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "posted_at must be an ISO date (YYYY-MM-DD)");

export const ingestJobSchema = z.object({
  external_job_id: z.string().min(1),
  title: z.string().min(1),
  job_url: z.string().url(),
  location: z.string().nullish(),
  department: z.string().nullish(),
  description: z.string().nullish(),
  employment_type: z.string().nullish(),
  /** A real date or null. Never a display string -- the crawler rejects those at its boundary. */
  posted_at: isoDate.nullish(),
  raw_metadata: z.record(z.string(), z.unknown()).optional(),
});

export const crawlStatusSchema = z.enum([
  "success",
  "failed",
  "suspicious",
  "degraded",
  "skipped",
]);

export const ingestPayloadSchema = z.object({
  run_id: z.string().min(1),
  company_id: z.string().min(1),
  status: crawlStatusSchema,
  tier: z.number().int().min(1).max(6).optional(),
  duration_ms: z.number().int().nonnegative().optional(),
  etag: z.string().nullish(),
  last_modified: z.string().nullish(),
  content_hash: z.string().nullish(),
  skip_reason: z.string().nullish(),
  error: z.string().nullish(),
  seen_external_ids: z.array(z.string()).default([]),
  jobs: z.array(ingestJobSchema).default([]),
  /**
   * False for all but the last chunk when a company's jobs are split across requests.
   * Presence tracking must run exactly once per crawl, against the complete observed id set --
   * running it on a partial chunk would mark every unlisted job as missing.
   */
  is_final: z.boolean().default(true),
});

export type IngestPayload = z.infer<typeof ingestPayloadSchema>;
export type IngestJob = z.infer<typeof ingestJobSchema>;
