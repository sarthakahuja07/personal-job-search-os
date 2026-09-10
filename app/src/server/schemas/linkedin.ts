import { z } from "zod";

/**
 * The LinkedIn-mail contract, crawler -> app.
 *
 * Unlike `/api/ingest/jobs` this is not per-company: a mailbox spans employers, including ones
 * that are not on the board. The server resolves each posting, because only the server knows
 * the company list and what is already discovered — the crawler stays dumb, as everywhere else.
 */
export const linkedinPostingSchema = z.object({
  /** LinkedIn's own numeric posting id, from /jobs/view/<id>/. Never synthesised. */
  linkedin_job_id: z.string().regex(/^\d+$/, "linkedin_job_id must be LinkedIn's numeric id"),
  company_name: z.string().min(1),
  title: z.string().min(1),
  location: z.string().nullish(),
  work_mode: z.enum(["on-site", "onsite", "hybrid", "remote"]).nullish(),
  job_url: z.string().url(),
  feed: z.enum(["search", "recommended"]),
  /** Which saved search surfaced it, when the subject named one. */
  search_term: z.string().nullish(),
});

export const linkedinIngestSchema = z.object({
  run_id: z.string().min(1),
  postings: z.array(linkedinPostingSchema).default([]),
});

export type LinkedInPostingPayload = z.infer<typeof linkedinPostingSchema>;
export type LinkedInIngestPayload = z.infer<typeof linkedinIngestSchema>;
